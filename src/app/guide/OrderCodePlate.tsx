"use client";

import { useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   «Код вашего заказа» на странице инструкции (01.11.2026).

   Покупатель приходит по ссылке, где код уже подставлен, и не видит его вовсе.
   Потом пишет в поддержку всё, кроме кода, и заказ ищут вручную по нику и
   сумме. Плашка называет код прямо и даёт его скопировать — тот же код стоит
   строкой в сообщении WB (`wbOrderCodeLines`).
   ───────────────────────────────────────────────────────────────────────── */

export default function OrderCodePlate({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // WebView без доступа к буферу — выделяем текст, человек скопирует сам.
      const el = document.getElementById("wbi-order-code");
      if (el) window.getSelection()?.selectAllChildren(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="wbi-codeplate" role="note" aria-label={`Код вашего заказа ${code}`}>
      <div className="wbi-codeplate-main">
        <small>Код вашего заказа</small>
        <strong id="wbi-order-code">{code}</strong>
        <span>Сохраните его. Если напишете нам — назовите код, так мы сразу найдём заказ.</span>
      </div>
      <button type="button" className="wbi-codeplate-copy" onClick={copy}>
        {copied ? "✓ Скопирован" : "Скопировать"}
      </button>
    </div>
  );
}
