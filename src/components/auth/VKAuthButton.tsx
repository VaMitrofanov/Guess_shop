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
      if (!(window as any).VKIDSDK_INITIALIZED) {
        VKID.Config.init({
          app:          54539012,
          redirectUrl:  origin,
          responseMode: VKID.ConfigResponseMode.Callback,
          source:       VKID.ConfigSource.LOWCODE,
        });
        (window as any).VKIDSDK_INITIALIZED = true;
      }

      if (!containerRef.current) return;

      // Fresh OneTap instance every mount — registers correct mode/wbCode
      // in the closure, even after page navigation.
      const oneTap = new VKID.OneTap();
      oneTap
        .render({
          container:            containerRef.current,
          showAlternativeLogin: true,
          contentId:            2,
        })
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
                // For login mode: NEVER pass wb_code — explicitly cleared to
                // prevent URL params or cookies from leaking into signIn and
                // triggering the order-mode TG notification in auth.ts.
                let resolvedWbCode = "";
                if (mode === "order") {
                  const urlParams   = new URLSearchParams(window.location.search);
                  const fromUrl     = urlParams.get("code") || urlParams.get("wb_code") || "";
                  const cookieMatch = document.cookie.match(/wb_code=([^;]+)/);
                  const fromCookie  = cookieMatch ? cookieMatch[1].trim() : "";
                  resolvedWbCode    = (wbCodeProp || fromUrl || fromCookie).toUpperCase();
                }
                // Safety guard: if somehow we're in login mode with a non-empty code, discard it
                if (mode === "login") resolvedWbCode = "";

                // ── signIn via NextAuth ───────────────────────────────────
                const { signIn } = await import("next-auth/react");
                const params: Record<string, string | boolean> = {
                  vk_id:    String(data.user_id),
                  name,
                  image,
                  redirect: false,
                };
                if (mode === "order" && resolvedWbCode) {
                  params.wb_code = resolvedWbCode;
                }

                const result = await signIn("vk-id", params);

                if (result?.ok) {
                  if (mode === "order" && resolvedWbCode) {
                    console.log("Redirecting to VK Community with ref:", resolvedWbCode);
                    window.location.href = customRedirectUrl || `${VK_CLUB_HREF}?ref=${resolvedWbCode}`;
                  } else {
                    console.log("Redirecting to Dashboard");
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
    <div className="flex flex-col items-center gap-2 w-full min-h-[44px] justify-center text-center">
      {isSdkLoading && !error && (
        <div className="flex items-center gap-2 py-2">
          <div className="w-3 h-3 border-2 border-[#0077FF] border-t-transparent animate-spin" />
          <span className="font-pixel text-[8px] text-[#0077FF]/60 uppercase tracking-widest">
            Загрузка VK ID...
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className={`w-full flex justify-center ${isSdkLoading ? "hidden" : "block"}`}
      />
      {error && (
        <p className="text-red-500 text-[10px] sm:text-xs mt-2 font-bold text-center uppercase tracking-wider">
          {error}
        </p>
      )}
    </div>
  );
}
