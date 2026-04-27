"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  /** Visible button label. Default — "ВКонтакте". */
  label?: string;
  /** Visual variant.
   *  - "match-tg" (default) — looks like the Telegram pixel button next to it.
   *  - "compact" — narrower; for the login/dashboard cards. */
  variant?: "match-tg" | "compact";
}

/**
 * Custom-styled VK ID auth button.
 * --------------------------------
 * Why two layers (visible button + hidden OneTap widget):
 *   - The VK ID OneTap widget owns the entire OAuth handshake (Config.init,
 *     code exchange, signed JWT id_token). Rebuilding that flow ourselves
 *     would be a regression risk.
 *   - But the OneTap widget renders its own UI — a solid blue card with an
 *     avatar circle and "Получить для Nick" text — that visually clashes
 *     with the Telegram button next to it.
 *   - Solution: mount the OneTap widget but make it invisible (opacity:0 +
 *     pointer-events:none on the wrapper). Render our own <button> on top
 *     in the same shape/style as the Telegram pixel button. On click, find
 *     the actual VK button inside the hidden widget and dispatch click()
 *     synthetically. The OneTap widget then runs its normal flow and emits
 *     LOGIN_SUCCESS, which we still handle below.
 */
export default function VKAuthButton({
  mode = "login",
  wbCode: wbCodeProp,
  customRedirectUrl,
  label = "ВКонтакте",
  variant = "match-tg",
}: VKAuthButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError]  = useState<string | null>(null);
  const [busy, setBusy]    = useState(false); // spinner while popup is open
  const [ready, setReady]  = useState(false); // SDK widget mounted

  // ── Bootstrap VK ID SDK + mount hidden OneTap widget ──────────────────────
  useEffect(() => {
    const initVK = () => {
      if (!window.VKIDSDK) {
        setTimeout(initVK, 300);
        return;
      }

      const VKID = window.VKIDSDK;
      const origin = window.location.origin.replace(/\/$/, "");

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

      const oneTap = new VKID.OneTap();

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
          setBusy(false);
          if (err.text !== "NEW TAB HAS BEEN CLOSED") {
            setError(`Ошибка VK ID: ${err.text || "неизвестная ошибка"}`);
          }
        })
        .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
          console.log("VK Auth success. Mode:", mode, "WB Code:", wbCodeProp);
          VKID.Auth.exchangeCode(payload.code, payload.device_id)
            .then(async (data) => {
              try {
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

                const isLoginMode = mode === "login";

                const urlParams    = new URLSearchParams(window.location.search);
                const queryWbCode  = urlParams.get("code") || urlParams.get("wb_code") || "";
                const cookieMatch  = document.cookie.match(/wb_code=([^;]+)/);
                const cookieWbCode = cookieMatch ? cookieMatch[1].trim() : "";

                const finalWbCode = isLoginMode
                  ? null
                  : (wbCodeProp || queryWbCode || cookieWbCode || null);
                const resolvedWbCode = finalWbCode ? finalWbCode.toUpperCase() : "";

                const { signIn } = await import("next-auth/react");
                const credentials: Record<string, string> = {
                  vk_id: String(data.user_id),
                  name,
                  image,
                };
                if (resolvedWbCode) credentials.wb_code = resolvedWbCode;

                const result = await signIn("vk-id", { ...credentials, redirect: false });

                if (result?.ok) {
                  if (isLoginMode) {
                    window.location.href = customRedirectUrl || "/dashboard";
                    return;
                  }
                  if (resolvedWbCode) {
                    window.location.href = customRedirectUrl || `${VK_CLUB_HREF}?ref=${resolvedWbCode}`;
                  } else {
                    window.location.href = customRedirectUrl || "/dashboard";
                  }
                } else {
                  setError(result?.error || "Ошибка авторизации на сервере");
                  setBusy(false);
                }
              } catch (e) {
                console.error("VK Auth Flow Error:", e);
                setError("Ошибка обработки данных профиля VK");
                setBusy(false);
              }
            })
            .catch((err) => {
              console.error("Exchange Error:", err);
              setError("Ошибка авторизации (Код ошибки: " + (err.error || "unknown") + ")");
              setBusy(false);
            });
        });

      // Give the OneTap widget a beat to actually inject its DOM, then mark ready.
      setTimeout(() => setReady(true), 600);
    };

    initVK();
  // mode / wbCodeProp captured at mount — intentionally no deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Forward our visible click to the hidden OneTap button ─────────────────
  const handleVisibleClick = useCallback(() => {
    setError(null);
    if (!ready) return;
    const root = containerRef.current;
    if (!root) return;

    // OneTap widget renders a clickable element — usually <button>, sometimes
    // an <a> inside a custom web component. Try a few selectors.
    const candidates: HTMLElement[] = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, a, [role="button"], div[class*="OneTapButton"], div[class*="vkidButton"]'
      )
    );

    const target = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0; // skip hidden ones
    }) || candidates[0];

    if (!target) {
      console.warn("[VKAuthButton] OneTap target not found in container");
      setError("VK виджет не загрузился — обновите страницу");
      return;
    }

    setBusy(true);
    target.click();
    // The OneTap popup closes asynchronously; reset busy after a generous
    // window if no LOGIN_SUCCESS / ERROR fires (e.g., user closes the tab).
    window.setTimeout(() => setBusy(false), 30_000);
  }, [ready]);

  const isCompact = variant === "compact";

  return (
    <div className="vk-auth-shell relative w-full h-full flex items-stretch min-h-[44px]">
      {/* Visible button — matches Telegram pixel-style sibling */}
      <button
        type="button"
        onClick={handleVisibleClick}
        disabled={!ready || busy}
        aria-label={`Войти через ${label}`}
        className={[
          "relative z-10 w-full h-full",
          "flex items-center justify-center gap-2.5",
          "font-black text-[11px] uppercase tracking-widest text-white",
          "bg-transparent border-0 cursor-pointer",
          "transition-opacity duration-150",
          (!ready || busy) ? "opacity-60 cursor-wait" : "hover:opacity-100",
          isCompact ? "px-3" : "px-2",
        ].join(" ")}
      >
        {busy ? (
          <span className="w-4 h-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            className="w-5 h-5 flex-shrink-0 text-[#0077FF] transition-transform group-hover/vk:scale-110"
          >
            {/* Compact VK glyph (rounded square + "В" arrow) */}
            <path d="M12.785 16.241s.288-.032.435-.194c.135-.149.13-.43.13-.43s-.019-1.306.572-1.497c.582-.188 1.331 1.252 2.124 1.806.6.42 1.056.328 1.056.328l2.122-.03s1.111-.07.585-.957c-.043-.073-.306-.658-1.578-1.853-1.331-1.252-1.153-1.049.451-3.224.977-1.323 1.367-2.13 1.245-2.474-.116-.328-.834-.241-.834-.241l-2.387.015s-.177-.024-.308.056c-.128.078-.21.262-.21.262s-.378 1.022-.882 1.892c-1.062 1.834-1.487 1.931-1.661 1.816-.405-.267-.304-1.069-.304-1.638 0-1.778.267-2.519-.51-2.711-.258-.064-.448-.106-1.108-.113-.847-.009-1.564.003-1.97.207-.27.136-.479.439-.351.456.157.022.514.099.703.363.244.341.236 1.108.236 1.108s.14 2.083-.328 2.342c-.32.178-.76-.185-1.706-1.85-.484-.853-.85-1.795-.85-1.795s-.07-.176-.196-.27c-.152-.114-.365-.15-.365-.15l-2.268.015s-.34.01-.466.16c-.111.135-.009.412-.009.412s1.776 4.221 3.787 6.349c1.844 1.95 3.938 1.822 3.938 1.822h.949z" />
          </svg>
        )}
        <span>{busy ? "Открываем VK ID…" : label}</span>
      </button>

      {/* Hidden OneTap widget — does the actual OAuth handshake.
          Sits underneath the visible button, fully transparent, no pointer events. */}
      <div
        ref={containerRef}
        aria-hidden="true"
        className="vk-auth-widget vk-auth-widget--ghost absolute inset-0 opacity-0 pointer-events-none overflow-hidden"
      />

      {error && (
        <p
          role="alert"
          className="absolute left-0 right-0 top-full mt-1 text-red-400 text-[10px] sm:text-xs font-bold text-center uppercase tracking-wider z-20"
        >
          {error}
        </p>
      )}
    </div>
  );
}
