"use client";

/**
 * Строка «ты уже заплатил на Wildberries» у кассы сайта.
 *
 * Зачем. Рельсы против второй оплаты (`src/lib/active-order.ts`,
 * `bots/shared/corridor-guard.ts`) все до одной ключуются на `userId`, то есть
 * работают только для вошедшего. Покупатель карты ВБ в кассу приходит АНОНИМНО:
 * он набрал домен руками (в сообщении чата ВБ вторая строка зовёт именно на
 * `robloxbank.ru/guide?source=wb`, и люди обрезают хвост), увидел калькулятор
 * «К оплате … ₽» и кнопку «Войти». Отказ `CORRIDOR_ORDER_ACTIVE` прилетает
 * только на создании заказа — то есть ПОСЛЕ логина, когда человек уже полчаса
 * уверен, что должен заплатить второй раз.
 *
 * Живой случай: `BGPZUH2` (15.09.2026). В чат ВБ: «Предлагает оплатить»,
 * «Почему просит оплатить?», «Нажать войти?».
 *
 * Поэтому подсказка здесь СТАТИЧЕСКАЯ и от сессии не зависит: её видит любой,
 * кто дошёл до цены. Cookie `wb_code` (её ставит сама инструкция,
 * `persistWbCodeSession`) только УТОЧНЯЕТ текст до «твой заказ такой-то» —
 * полагаться на неё нельзя: у покупателя, открывшего ссылку в WebView Telegram,
 * в обычном браузере её не будет.
 *
 * Это не запрет: повторная покупка напрямую законна и остаётся в один тап.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

/** Код с карточки ВБ — семь символов, буквы и цифры (зеркало `isWbCode`). */
const WB_CODE_RE = /^[A-Z0-9]{7}$/;

export default function CorridorNotice({
  className,
  linkClassName,
}: {
  className?: string;
  linkClassName?: string;
}) {
  const [code, setCode] = useState<string | null>(null);

  // Чтение в эффекте, а не при рендере: первый HTML одинаков для всех, поэтому
  // гидратация не расходится, а персональный текст приезжает сразу после неё.
  useEffect(() => {
    try {
      const match = document.cookie.match(/(?:^|;\s*)wb_code=([^;]+)/);
      const raw = match ? decodeURIComponent(match[1]).trim().toUpperCase() : "";
      if (WB_CODE_RE.test(raw)) setCode(raw);
    } catch {
      // Cookie недоступна (приватное окно, запрет) — остаётся общий текст.
    }
  }, []);

  const href = code
    ? `/guide?source=wb&skip=1&code=${encodeURIComponent(code)}`
    : "/guide?source=wb";

  return (
    <div className={className} role="note">
      <strong>
        {code
          ? `У тебя есть заказ по карте Wildberries — код ${code}`
          : "Карточку купил на Wildberries? Платить здесь не нужно"}
      </strong>
      <small>
        {code
          ? "За него уже заплачено на Wildberries. Робуксы выдаются по коду — второй раз платить не нужно."
          : "Оплата за карточку уже прошла на Wildberries. Робуксы по ней выдаются по коду с карточки, а не через эту кассу."}
      </small>
      <Link href={href} className={linkClassName}>
        {code ? "Вернуться к своему заказу →" : "Открыть заказ по коду →"}
      </Link>
    </div>
  );
}
