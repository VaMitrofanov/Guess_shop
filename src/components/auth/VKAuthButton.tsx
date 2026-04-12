"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface VKAuthButtonProps {
  appId?: number;
  redirectUrl?: string;
}

export default function VKAuthButton({ 
  appId = 54539012, 
  redirectUrl: customRedirectUrl 
}: VKAuthButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSdkLoading, setIsSdkLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Определяем redirectUrl: либо переданный пропс, либо динамический для текущего домена
    const defaultRedirect = typeof window !== "undefined" 
      ? `${window.location.origin}/api/auth/callback/vk`
      : "https://www.robloxbank.ru/api/auth/callback/vk";
    
    const redirectUrl = customRedirectUrl || defaultRedirect;

    const initVK = () => {
      if (typeof window !== "undefined" && window.VKIDSDK) {
        const VKID = window.VKIDSDK;

        // Очищаем контейнер перед рендером, чтобы избежать дублей
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }

        VKID.Config.init({
          app: appId,
          redirectUrl: redirectUrl,
          responseMode: VKID.ConfigResponseMode.Callback,
          scope: "",
        });

        const oneTap = new VKID.OneTap();

        if (containerRef.current) {
          oneTap.render({
            container: containerRef.current,
            showAlternativeLogin: true,
            contentId: 2,
          })
          .on(VKID.WidgetEvents.ERROR, (err) => {
            console.error("VK ID Error:", err);
            setIsSdkLoading(false);
            if (err.text !== "NEW TAB HAS BEEN CLOSED") {
              setError(`Ошибка VK ID: ${err.text || "неизвестная ошибка"}`);
            }
          })
          .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
            const code = payload.code;
            const deviceId = payload.device_id;

            // 1. Обмениваем код на токен прямо на КЛИЕНТЕ
            VKID.Auth.exchangeCode(code, deviceId)
              .then(async (data) => {
                const idToken = data.id_token;

                try {
                  // 2. Декодируем JWT (ID Token) для получения данных профиля
                  let name = "VK User";
                  let image = "";

                  if (idToken) {
                    try {
                      const base64Url = idToken.split('.')[1];
                      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                      const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
                          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                      }).join(''));
                      const payload = JSON.parse(jsonPayload);
                      
                      // Поля VK ID v2: first_name, last_name, nickname, photo_max, picture
                      const firstName = payload.first_name || "";
                      const lastName = payload.last_name || "";
                      const nickname = payload.nickname || "";
                      
                      name = payload.name || `${firstName} ${lastName}`.trim() || nickname || "VK User";
                      image = payload.picture || payload.photo_max || payload.photo_200 || "";
                    } catch (jwtErr) {
                      console.error("JWT Decode Error:", jwtErr);
                    }
                  }

                  // 3. Выполняем вход через NextAuth (signIn)
                  // Получаем wb_code из URL или кук (URL приоритетнее)
                  const urlParams = new URLSearchParams(window.location.search);
                  const wbCodeFromUrl = urlParams.get("code") || urlParams.get("wb_code");
                  const wbCodeMatch = document.cookie.match(/wb_code=([^;]+)/);
                  const wbCodeFromCookie = wbCodeMatch ? wbCodeMatch[1].trim() : null;
                  const wbCode = (wbCodeFromUrl || wbCodeFromCookie || "").toUpperCase();

                  const { signIn } = await import("next-auth/react");
                  const result = await signIn("vk-id", {
                    vk_id: String(data.user_id),
                    name,
                    image,
                    wb_code: wbCode,
                    redirect: false,
                  });

                  if (result?.ok) {
                    if (wbCode && wbCode.length === 7) {
                      // Если есть код -> Редирект в ВК (по вашему желанию vk.ru/bankroblox)
                      window.location.href = `https://vk.ru/bankroblox?ref=${wbCode}`;
                    } else {
                      // Если обычный вход -> В личный кабинет
                      router.push("/dashboard");
                      router.refresh();
                    }
                  } else {
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

          // Скрываем лоадер через небольшую паузу после команды рендера
          setTimeout(() => setIsSdkLoading(false), 500);
        }
      } else {
        setTimeout(initVK, 300);
      }
    };

    initVK();
  }, [appId, customRedirectUrl, router]);

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
