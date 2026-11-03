"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   Превью сообщения покупателю — как оно придёт в Telegram или VK.

   Строится тем же `buyerStepMessage`, что и сама отправка (`notifyBuyerStep`),
   поэтому совпадает с ней один в один. Общий для TWA и /admin: обе админки
   тёмные, а превью нарочно выглядит как чат, а не как админка.
   ───────────────────────────────────────────────────────────────────────── */

import type { ReactNode } from "react";
import {
  buyerStepMessage,
  stripHtml,
  type BuyerStepKind,
  type BuyerStepOrder,
} from "../../bots/shared/buyer-step";

/** Разметка Telegram → React без dangerouslySetInnerHTML: только b/i/code. */
function renderTgHtml(html: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /<(b|i|code)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  const plain = (text: string) => stripHtml(text);
  while ((match = re.exec(html))) {
    if (match.index > last) out.push(plain(html.slice(last, match.index)));
    const inner = plain(match[2]);
    if (match[1] === "b") out.push(<b key={key++}>{inner}</b>);
    else if (match[1] === "i") out.push(<i key={key++}>{inner}</i>);
    else out.push(<code key={key++} style={{ background: "rgba(255,255,255,.08)", padding: "0 4px", borderRadius: 4, fontFamily: "ui-monospace, Menlo, monospace" }}>{inner}</code>);
    last = match.index + match[0].length;
  }
  if (last < html.length) out.push(plain(html.slice(last)));
  return out;
}

export function BuyerMessagePreview({ kind, order, customText, channel }: {
  kind: BuyerStepKind;
  order: BuyerStepOrder;
  customText?: string;
  channel: "tg" | "vk" | null;
}) {
  const text = kind === "custom" && !customText?.trim() ? "Ваш текст появится здесь" : customText;
  const msg = buyerStepMessage(kind, order, text);
  const vk = channel === "vk";
  return (
    <div style={{
      background: vk ? "#19191a" : "#0e1621", borderRadius: 14, padding: 12,
      display: "flex", flexDirection: "column", gap: 6, border: "1px solid rgba(255,255,255,.08)",
    }}>
      <div style={{ fontSize: 13, color: "#8b8f98", display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{vk ? "Сообщество VK · так увидит покупатель" : "Бот в Telegram · так увидит покупатель"}</span>
      </div>
      <div style={{
        background: vk ? "#2c2d2e" : "#182533", borderRadius: "14px 14px 14px 4px", padding: "10px 12px",
        fontSize: 14, lineHeight: 1.45, color: "#e9eef3", whiteSpace: "pre-line", overflowWrap: "anywhere",
      }}>
        {vk ? stripHtml(msg.html) : renderTgHtml(msg.html)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {msg.buttons.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 4 }}>
            {row.map((button) => (
              <span key={button.label} style={{
                flex: 1, textAlign: "center", background: vk ? "#3a3b3c" : "#1f2f3f", borderRadius: 8,
                padding: "8px 6px", fontSize: 13, color: "#e9eef3",
              }}>
                {button.label}{"url" in button ? <span style={{ color: "#6ab3f3" }}> ↗</span> : null}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
