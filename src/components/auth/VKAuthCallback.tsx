"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Доводит вход через VK ID, если окно возврата осталось одно.
 *
 * Как это работает штатно: `VKAuthButton` открывает окно VK ID
 * (`ConfigAuthMode.InNewWindow`), VK возвращает его на `redirectUrl` — а это
 * корень сайта, — и SDK на стороне ОТКРЫВШЕЙ вкладки читает адрес этого окна,
 * забирает `code` и закрывает окно. Никакого кода на самой странице возврата
 * при этом не исполняется.
 *
 * Что ломалось (21.08.2026, покупательница Алла, заказ 5547803025): связь окна
 * с открывшей вкладкой рвётся — на iPhone это рядовое дело, вкладку в фоне
 * Safari усыпляет. Тогда никто код не забирает, окно остаётся стоять на главной
 * странице, а главная у нас — витрина прямых продаж. Человек, оплативший заказ
 * на Wildberries, логично жмёт «купить» и упирается в экран оплаты. Три захода
 * подряд, ни одного завершённого входа: в логах три полноценные загрузки
 * `/?code=vk2…`, а в базе — ни сессии, ни привязки, ни заказа.
 *
 * Что делает этот компонент: если страница загрузилась с параметрами возврата
 * VK ID и её никто не закрыл, он доводит ровно тот же вход, что и кнопка —
 * `exchangeCode` → `signIn("vk-id", { access_token, wb_code })` → диалог
 * сообщества с `?ref=` (заказ) или личный кабинет (обычный вход). Логика
 * привязки не меняется: те же вызовы, тот же порядок, тот же финальный шаг.
 *
 * Обмен возможен вне открывшей вкладки только потому, что SDK хранит `state` и
 * `codeVerifier` в cookie (`vkid_sdk:*`, 15 минут), а не в памяти вкладки —
 * см. `@vkid/sdk/dist-sdk/esm/utils/cookie.js`. Ключ PKCE, таким образом,
 * доступен любой вкладке того же домена.
 */

/** Куда возвращаем покупателя с активным кодом — тот же диалог, что и у кнопки. */
const VK_CLUB_HREF = "https://vk.me/club237309399";
const SUPPORT_URL = "https://t.me/RobloxBank_PA";

/** Одноразовость на весь документ: StrictMode вызывает эффекты дважды, а код
 * авторизации VK одноразовый — второй обмен гарантированно вернёт ошибку. */
let exchangeStarted = false;

/**
 * Признак возврата VK ID. Строгий намеренно: компонент висит в корневом layout,
 * то есть на КАЖДОЙ странице сайта, а `?code=` встречается и в наших
 * собственных ссылках (`/checkout?code=…`, реферальные хвосты). Ошибиться здесь
 * — значит показать оверлей поверх обычной страницы.
 */
export function parseVkIdCallback(search: string): { code: string; deviceId: string } | null {
  const params = new URLSearchParams(search);
  if (params.get("type") !== "code_v2") return null;
  const code = params.get("code")?.trim() ?? "";
  const deviceId = params.get("device_id")?.trim() ?? "";
  if (!code || !deviceId) return null;
  return { code, deviceId };
}

type Phase = "idle" | "working" | "failed";

/** Обрыв возврата VK ID раньше был невидим: он не роняет сервер и ничего не
 * пишет в базу — узнавали о нём по скриншоту от клиента. Сигнал идёт в тот же
 * канал, что и клиентские ошибки: `kind` — что случилось, `fingerprint` —
 * восемь hex-символов по контракту схемы. */
function reportVkCallback(kind: "vk-callback-rescued" | "vk-callback-failed"): void {
  try {
    const body = JSON.stringify({
      type: "client-error",
      route: "/",
      kind,
      fingerprint: kind === "vk-callback-rescued" ? "0acce55e" : "0badc0de",
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/observability/client", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/observability/client", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Наблюдаемость не имеет права мешать входу.
  }
}

export default function VKAuthCallback() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [wbCode, setWbCode] = useState<string>("");

  const finish = useCallback(async (code: string, deviceId: string) => {
    const appId = Number(process.env.NEXT_PUBLIC_VK_APP_ID ?? "54539012");
    if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("VK app id is not configured");

    const VKID = await import("@vkid/sdk");
    VKID.Config.init({
      app: appId,
      redirectUrl: window.location.origin.replace(/\/$/, ""),
      mode: VKID.ConfigAuthMode.InNewWindow,
      responseMode: VKID.ConfigResponseMode.Callback,
      source: VKID.ConfigSource.LOWCODE,
    });

    const data = await VKID.Auth.exchangeCode(code, deviceId);
    const accessToken = data?.access_token ?? "";
    if (!accessToken) throw new Error("VK ID did not return an access token");

    // Тот же источник кода, что и в кнопке: cookie пишет гейт инструкции
    // (`persistWbCodeSession`). `?code=` из адреса здесь занят кодом VK, так что
    // спутать их нельзя.
    const cookieMatch = document.cookie.match(/(?:^|;\s*)wb_code=([^;]+)/);
    const resolvedWbCode = cookieMatch ? cookieMatch[1].trim().toUpperCase() : "";

    const credentials: Record<string, string> = { access_token: accessToken };
    if (resolvedWbCode) credentials.wb_code = resolvedWbCode;

    const { signIn } = await import("next-auth/react");
    const result = await signIn("vk-id", { ...credentials, redirect: false });
    if (!result?.ok) throw new Error(result?.error || "vk-id sign-in rejected");

    // U8: код мог быть активирован другим аккаунтом — уводить человека в чужой
    // заказ нельзя. Зеркало проверки из VKAuthButton.
    if (resolvedWbCode) {
      const session = await fetch("/api/auth/session", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      if (session?.user?.wb_code_conflict) throw new Error("wb_code_conflict");
    }

    window.location.replace(
      resolvedWbCode ? `${VK_CLUB_HREF}?ref=${encodeURIComponent(resolvedWbCode)}` : "/dashboard",
    );
  }, []);

  useEffect(() => {
    const callback = parseVkIdCallback(window.location.search);
    if (!callback) return;
    if (exchangeStarted) return;
    const { code, deviceId } = callback;

    // Фора открывшей вкладке: пока она жива и не усыплена, забрать код должна
    // она — так работает штатный путь, и перебивать его нельзя (код
    // одноразовый, второй обмен убил бы её вход). Если через паузу нас всё ещё
    // не закрыли, значит забирать некому.
    const grace = window.opener && !window.opener.closed ? 4000 : 400;
    const timer = window.setTimeout(() => {
      if (exchangeStarted) return;
      exchangeStarted = true;
      const cookieMatch = document.cookie.match(/(?:^|;\s*)wb_code=([^;]+)/);
      setWbCode(cookieMatch ? cookieMatch[1].trim().toUpperCase() : "");
      setPhase("working");
      reportVkCallback("vk-callback-rescued");
      finish(code, deviceId).catch((error) => {
        console.error("[VKAuthCallback] не удалось довести вход:", error);
        reportVkCallback("vk-callback-failed");
        setPhase("failed");
      });
    }, grace);

    return () => window.clearTimeout(timer);
  }, [finish]);

  if (phase === "idle") return null;

  // Экран поверх страницы: без него человек остаётся на витрине и не понимает,
  // что его заказ вообще-то в другом месте.
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(11, 9, 18, 0.96)",
        color: "#f4f0ff",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420, display: "grid", gap: 14 }}>
        {phase === "working" ? (
          <>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Завершаем вход через ВКонтакте…</div>
            <div style={{ color: "#b8b0c5", fontSize: 16, lineHeight: 1.55 }}>
              Это займёт пару секунд — сейчас вернём тебя к заказу.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Вход не завершился</div>
            <div style={{ color: "#b8b0c5", fontSize: 16, lineHeight: 1.55 }}>
              Ничего не потерялось{wbCode ? <>, заказ по коду <b>{wbCode}</b> на месте</> : null}. Открой диалог
              ВКонтакте — там всё продолжится с того же места.
            </div>
            <a
              href={wbCode ? `${VK_CLUB_HREF}?ref=${encodeURIComponent(wbCode)}` : VK_CLUB_HREF}
              style={{
                display: "block",
                padding: "14px 18px",
                borderRadius: 12,
                background: "linear-gradient(180deg,#3d8bff,#0a66e0)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 17,
                textDecoration: "none",
              }}
            >
              Открыть диалог ВКонтакте
            </a>
            <a href={SUPPORT_URL} style={{ color: "#9f8cff", fontSize: 15 }}>
              Не получается? Написать менеджеру
            </a>
          </>
        )}
      </div>
    </div>
  );
}
