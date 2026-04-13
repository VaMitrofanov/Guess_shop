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
    // Prevent double-init: React StrictMode fires useEffect twice in dev;
    // navigating between pages must not reinitialise an already-running SDK.
    if ((window as any).VKIDSDK_INITIALIZED) {
      setLoading(false);
      return;
    }

    // redirectUrl must exactly match the entry in VK Business panel.
    // Using origin only (no path) avoids trailing-slash mismatches.
    const origin = window.location.origin.replace(/\/$/, "");

    const initVK = () => {
      if (!window.VKIDSDK) {
        setTimeout(initVK, 300);
        return;
      }

      const VKID = window.VKIDSDK;

      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }

      VKID.Config.init({
        app:          54539012,               // always numeric
        redirectUrl:  origin,
        responseMode: VKID.ConfigResponseMode.Callback,
        source:       VKID.ConfigSource.LOWCODE, // required for OneTap / low-code
      });

      (window as any).VKIDSDK_INITIALIZED = true;

      const oneTap = new VKID.OneTap();

      if (!containerRef.current) return;

      oneTap
        .render({
          container:            containerRef.current,
          showAlternativeLogin: true,
          contentId:            2,
        })
        .on(VKID.WidgetEvents.ERROR, (err) => {
          console.error("VK SDK Full Error:", err);
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
                    const decoded     = JSON.parse(jsonPayload);
                    const firstName   = decoded.first_name || "";
                    const lastName    = decoded.last_name  || "";
                    name  = decoded.name || `${firstName} ${lastName}`.trim() || decoded.nickname || "VK User";
                    image = decoded.picture || decoded.photo_max || decoded.photo_200 || "";
                  } catch (jwtErr) {
                    console.error("JWT Decode Error:", jwtErr);
                  }
                }

                // ── Resolve wb_code (order mode only) ────────────────────
                let resolvedWbCode = "";
                if (mode === "order") {
                  const urlParams   = new URLSearchParams(window.location.search);
                  const fromUrl     = urlParams.get("code") || urlParams.get("wb_code") || "";
                  const cookieMatch = document.cookie.match(/wb_code=([^;]+)/);
                  const fromCookie  = cookieMatch ? cookieMatch[1].trim() : "";
                  resolvedWbCode    = (wbCodeProp || fromUrl || fromCookie).toUpperCase();
                }

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
                  // Strict check: only redirect to VK when both order mode AND a code exist
                  if (mode === "order" && resolvedWbCode) {
                    window.location.href = customRedirectUrl || `${VK_CLUB_HREF}?ref=${resolvedWbCode}`;
                  } else {
                    // mode === 'login', or order mode without a code — go to dashboard
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
  // mode / wbCodeProp captured at mount — intentionally no deps
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
