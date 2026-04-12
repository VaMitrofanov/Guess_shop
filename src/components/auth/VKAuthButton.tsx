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
            // Игнорируем ошибку "NEW TAB HAS BEEN CLOSED", так как она техническая 
            // и часто возникает при фоновых проверках SDK.
            if (err.text !== "NEW TAB HAS BEEN CLOSED") {
              setError(`Ошибка VK ID: ${err.text || "неизвестная ошибка"}`);
            }
          })
          .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
            const code = payload.code;
            const deviceId = payload.device_id;

            VKID.Auth.exchangeCode(code, deviceId)
              .then(async (data) => {
                try {
                  const res = await fetch("/api/auth/vk-callback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      access_token: data.access_token,
                      user_id: data.user_id,
                    }),
                  });

                  if (res.ok) {
                    const resData = await res.json();
                    const target = resData.redirectUrl || "/dashboard";
                    router.push(target);
                    router.refresh();
                  } else {
                    const errData = await res.json();
                    setError(errData.error || "Ошибка авторизации на сервере");
                  }
                } catch (e) {
                  setError("Сетевая ошибка при авторизации");
                }
              })
              .catch((err) => {
                console.error("Exchange Code Error:", err);
                setError("Ошибка обмена кодом VK");
              });
          });
        }
      } else {
        setTimeout(initVK, 300);
      }
    };

    initVK();
  }, [appId, customRedirectUrl, router]);

  return (
    <div className="flex flex-col items-center gap-2 w-full min-h-[44px]">
      <div ref={containerRef} className="w-full flex justify-center" />
      {error && (
        <p className="text-red-500 text-[10px] sm:text-xs mt-2 font-bold text-center uppercase tracking-wider">
          {error}
        </p>
      )}
    </div>
  );
}
