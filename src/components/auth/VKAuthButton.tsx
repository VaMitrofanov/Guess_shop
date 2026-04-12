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
            // Это решает проблему с Verifier (PKCE)
            VKID.Auth.exchangeCode(code, deviceId)
              .then(async (data) => {
                const accessToken = data.access_token;
                const userId = data.user_id;

                try {
                  // 2. Получаем данные пользователя прямо на КЛИЕНТЕ
                  // Это решает проблему с IP Address (запрос с IP пользователя)
                  // Используем JSONP или просто fetch к API VK (для клиентских токенов это Ок)
                  const vkApiUrl = `https://api.vk.com/method/users.get?user_ids=${userId}&fields=photo_200&access_token=${accessToken}&v=5.131`;
                  
                  // В браузере может быть CORS, поэтому используем наш прокси или просто передаем токен
                  // Но лучше получить имя прямо тут если возможно, либо отправить на сервер токен и пусть он пробует
                  // На самом деле, если мы передадим accessToken на сервер, он снова упадет по IP.
                  
                  // Давайте попробуем получить данные через fetch (VK API поддерживает CORS для некоторых методов)
                  const vkRes = await fetch(vkApiUrl);
                  const vkData = await vkRes.json();
                  
                  let name = "VK User";
                  let image = "";

                  if (vkData.response?.[0]) {
                    const u = vkData.response[0];
                    name = `${u.first_name} ${u.last_name}`.trim();
                    image = u.photo_200;
                  }

                  // 3. Отправляем готовые данные на наш сервер
                  const res = await fetch("/api/auth/vk-callback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      user_id: userId,
                      name: name,
                      image: image,
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
                  console.error("VK Info Error:", e);
                  setError("Ошибка получения данных профиля VK");
                }
              })
              .catch((err) => {
                console.error("Exchange Error:", err);
                setError("Ошибка обмена кодом (Verifier error)");
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
