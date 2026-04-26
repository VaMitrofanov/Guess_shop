"use client";

import { useEffect, useRef, useState } from "react";

// VK community ID for order-mode redirect
const VK_CLUB_HREF = "https://vk.me/club237309399";

interface VKAuthButtonProps {
  /** 'login' — sign in to the site dashboard (default).
   *  'order' — sign in and redirect to VK community with ref code. */
  mode?: "login" | "order";
  /** WB activation code (order mode). Falls back to URL param / cookie. */
  wbCode?: string;
  /** Override the final redirect URL for either mode. */
  customRedirectUrl?: string;
}

export default function VKAuthButton({
  mode = "login",
  wbCode: wbCodeProp,
  customRedirectUrl,
}: VKAuthButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError]           = useState<string | null>(null);
  const [isSdkLoading, setLoading]  = useState(true);

  useEffect(() => {
    // redirectUrl must exactly match the entry in VK Business panel.
    const origin = window.location.origin.replace(/\/$/, "");

    const initVK = () => {
      if (!window.VKIDSDK) {
        setTimeout(initVK, 300);
        return;
      }

      const VKID = window.VKIDSDK;

      // Always clear container before rendering to avoid duplicate widgets.
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }

      // Config.init must run only once per page load — calling it twice
      // causes the SDK to hang. Widget rendering (below) runs every mount.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(window as any).VKIDSDK_INITIALIZED) {
        VKID.Config.init({
          app:          54539012,
          redirectUrl:  origin,
          responseMode: VKID.ConfigResponseMode.Callback,
          source:       VKID.ConfigSource.LOWCODE,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).VKIDSDK_INITIALIZED = true;
      }

      if (!containerRef.current) return;

      // Fresh OneTap instance every mount — registers correct mode/wbCode
      // in the closure, even after page navigation.
      const oneTap = new VKID.OneTap();

      // Visual options — make the VK widget visually match our pixel-style
      // Telegram button (square corners, full width, 56px height).
      // SDK silently ignores keys it doesn't know, so unsupported props
      // (e.g. styles in older SDKs) won't break older runtimes.
      const renderOptions = {
        container:            containerRef.current,
        showAlternativeLogin: false,
        contentId:            2,
        styles: {
          borderRadius: 0,
          height:       56,
          width:        320,
        },
        scheme: "dark",
      } as Parameters<InstanceType<typeof VKID.OneTap>["render"]>[0];

      oneTap
        .render(renderOptions)
        .on(VKID.WidgetEvents.ERROR, (err) => {
          console.error("VK SDK Error:", err);
          setLoading(false);
          if (err.text !== "NEW TAB HAS BEEN CLOSED") {
            setError(`Ошибка VK ID: ${err.text || "неизвестная ошибка"}`);
          }
        })
        .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
          console.log("VK Auth Clicked. Mode:", mode, "WB Code:", wbCodeProp);
          VKID.Auth.exchangeCode(payload.code, payload.device_id)
            .then(async (data) => {
              try {
                // ── Decode ID token for profile data ──────────────────────
                let name  = "VK User";
                let image = "";

                if (data.id_token) {
                  try {
                    const base64Url   = data.id_token.split(".")[1];
                    const base64      = base64Url.replace(/-/g, "+").replace(/_/g, "/");
                    const jsonPayload = decodeURIComponent(
                      window.atob(base64).split("").map((c) =>
                        "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
                      ).join("")
                    );
                    const decoded   = JSON.parse(jsonPayload);
                    const firstName = decoded.first_name || "";
                    const lastName  = decoded.last_name  || "";
                    name  = decoded.name || `${firstName} ${lastName}`.trim() || decoded.nickname || "VK User";
                    image = decoded.picture || decoded.photo_max || decoded.photo_200 || "";
                  } catch (jwtErr) {
                    console.error("JWT Decode Error:", jwtErr);
                  }
                }

                // ── Resolve wb_code ───────────────────────────────────────
                const isLoginMode = mode === "login";

                const urlParams   = new URLSearchParams(window.location.search);
                const queryWbCode = urlParams.get("code") || urlParams.get("wb_code") || "";
                const cookieMatch = document.cookie.match(/wb_code=([^;]+)/);
                const cookieWbCode = cookieMatch ? cookieMatch[1].trim() : "";

                // Login mode ALWAYS ignores any wb_code — even if URL/cookies contain one.
                // Order mode: prop takes priority, then URL param, then cookie.
                const finalWbCode = isLoginMode
                  ? null
                  : (wbCodeProp || queryWbCode || cookieWbCode || null);
                const resolvedWbCode = finalWbCode ? finalWbCode.toUpperCase() : "";

                console.log("SUCCESS_HANDLER: Mode is", mode, "Final WB Code is", finalWbCode);

                // ── signIn via NextAuth ───────────────────────────────────
                const { signIn } = await import("next-auth/react");
                const credentials: Record<string, string> = {
                  vk_id: String(data.user_id),
                  name,
                  image,
                };
                if (resolvedWbCode) {
                  credentials.wb_code = resolvedWbCode;
                }

                const result = await signIn("vk-id", { ...credentials, redirect: false });

                if (result?.ok) {
                  // Login mode: always go to dashboard, no VK redirect
                  if (isLoginMode) {
                    window.location.href = customRedirectUrl || "/dashboard";
                    return;
                  }
                  // Order mode: go to VK community with ref if code is present
                  if (resolvedWbCode) {
                    console.log("Redirecting to VK Community with ref:", resolvedWbCode);
                    window.location.href = customRedirectUrl || `${VK_CLUB_HREF}?ref=${resolvedWbCode}`;
                  } else {
                    console.log("Redirecting to Dashboard (order mode, no code)");
                    window.location.href = customRedirectUrl || "/dashboard";
                  }
                } else {
                  console.error("VK signIn error:", result?.error);
                  setError(result?.error || "Ошибка авторизации на сервере");
                }
              } catch (e) {
                console.error("VK Auth Flow Error:", e);
                setError("Ошибка обработки данных профиля VK");
              }
            })
            .catch((err) => {
              console.error("Exchange Error:", err);
              setError("Ошибка авторизации (Код ошибки: " + (err.error || "unknown") + ")");
            });
        });

      setTimeout(() => setLoading(false), 500);
    };

    initVK();
  // mode / wbCodeProp are captured in the closure at mount — intentionally no deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="vk-auth-shell w-full flex flex-col items-stretch justify-center gap-2 min-h-[56px]">
      {isSdkLoading && !error && (
        // Skeleton matches the visual weight of the Telegram button while
        // the VK SDK widget is still booting — prevents layout jank.
        <div className="w-full h-11 flex items-center justify-center gap-3 border border-[#0077FF]/30 bg-[#0077FF]/10 animate-pulse">
          <div className="w-3.5 h-3.5 border-2 border-[#0077FF] border-t-transparent rounded-full animate-spin" />
          <span className="font-black text-[11px] uppercase tracking-widest text-[#0077FF]">
            Загрузка VK ID…
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className={`vk-auth-widget w-full flex justify-center ${isSdkLoading ? "hidden" : "block"}`}
      />
      {error && (
        <p className="text-red-500 text-[10px] sm:text-xs font-bold text-center uppercase tracking-wider">
          {error}
        </p>
      )}
    </div>
  );
}
