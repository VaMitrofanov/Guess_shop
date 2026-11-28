"use client";

import { useEffect, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { C } from "./theme";
import { fmtAge } from "./age";
import { haptic } from "./haptics";
import { toast } from "./Toast";

/* ─────────────────────────────────────────────────────────────────────────────
   ↩ Заявка на возврат WB прямо в карточке заказа (27.11.2026, мокап
   https://claude.ai/artifact/MUiwNghNKnnW6wCo6NE3zC).

   Показывается, только пока висит пометка «Возврат открыт». Главное действие —
   «Отклонить и выкупить» (владелец: любой возврат бьёт по рейтингу и даёт
   штраф, выкупить лучше). Кнопки строятся из того, что WB разрешает по этой
   заявке (`/api/twa/wb-claim`): чего WB не даёт — того и нет.
   ───────────────────────────────────────────────────────────────────────── */

interface ClaimView {
  id: string;
  openedAt: string | null;
  reason: string | null;
  decided: boolean;
  refunded: boolean;
  canReject: boolean;
  canRefund: boolean;
  rejectNeedsComment: boolean;
}

const REASONS = [
  { label: "Товар цифровой и работает: выкупаем заказ", text: "Карта цифровая и работает: робуксы зачисляются через геймпасс. Заказ выкупаем, поможем по шагам в чате заказа." },
  { label: "Робуксы уже выкуплены, ждут у Roblox", text: "Заказ выполнен: геймпасс выкуплен, робуксы на аккаунте покупателя в ожидании (Pending) по правилам Roblox." },
  { label: "Договорились с покупателем в чате", text: "Договорились с покупателем в чате заказа: выполняем заказ, возврат не нужен." },
];

/** TWA шлёт пропуск, сайт — сессию (пустой токен = без заголовка). */
const auth = (token: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

/** Пометка «Возврат открыт» без «✓ Договорились». */
export function hasOpenClaimFlag(flags: unknown): { at: string; detail: string | null } | null {
  if (!Array.isArray(flags)) return null;
  const f = flags.find((x) => x && typeof x === "object" && (x as { kind?: string }).kind === "CLAIM" && !(x as { ackAt?: string }).ackAt) as
    { at: string; detail?: string | null } | undefined;
  return f ? { at: f.at, detail: f.detail ?? null } : null;
}

export default function WbClaimPanel({ code, token, flags, onChanged }: {
  code: string;
  token: string;
  flags: unknown;
  onChanged: () => void;
}) {
  const flag = hasOpenClaimFlag(flags);
  const [claim, setClaim] = useState<ClaimView | null | undefined>(undefined);
  const [mode, setMode] = useState<"idle" | "reject" | "refund">("idle");
  const [reasonIdx, setReasonIdx] = useState(0);
  const [comment, setComment] = useState(REASONS[0].text);
  const [busy, setBusy] = useState(false);
  /** Итог прямо в блоке: на сайте нет тостов TWA. */
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!flag) return;
    let alive = true;
    fetch(`/api/twa/wb-claim?code=${encodeURIComponent(code)}`, { headers: auth(token), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setClaim(d?.claim ?? null); })
      .catch(() => { if (alive) setClaim(null); });
    return () => { alive = false; };
  }, [code, token, flag?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!flag) return null;

  async function send(decision: "reject" | "refund" | "keep") {
    if (busy) return;
    if (decision === "reject" && claim?.rejectNeedsComment && comment.trim().length < 10) {
      toast("Комментарий для WB — не короче 10 символов", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/twa/wb-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth(token) },
        body: JSON.stringify({ code, decision, comment: decision === "reject" ? comment.trim() : undefined }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        const text = d?.error ?? "Не получилось";
        haptic.notify("error"); toast(text, "error"); setNote({ ok: false, text });
        return;
      }
      const text = decision === "reject" ? "Возврат отклонён — заказ в очереди"
        : decision === "keep" ? "Пометка снята — заказ в очереди, заявку решите в WB"
        : "Деньги вернутся покупателю — заказ заморожен";
      haptic.notify("success"); toast(text, "success"); setNote({ ok: true, text });
      setMode("idle");
      onChanged();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); setNote({ ok: false, text: "Ошибка сети" }); }
    finally { setBusy(false); }
  }

  const red = "#ff6961";
  const reason = claim?.reason ?? flag.detail;
  const openedAt = claim?.openedAt ? `${claim.openedAt.replace(/(\.\d+)?$/, "")}+03:00` : flag.at;
  const canAct = claim && !claim.decided && (claim.canReject || claim.canRefund);

  return (
    <section aria-label="Заявка на возврат WB" style={{
      margin: "12px 0", borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 12,
      background: "linear-gradient(180deg, rgba(255,69,58,0.14), rgba(255,69,58,0.06))", border: "1px solid rgba(255,105,97,0.35)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 12, background: "rgba(255,69,58,0.22)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Undo2 size={19} color={red} aria-hidden="true" />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <strong style={{ fontSize: 17, color: C.textPrimary }}>Просит возврат на WB</strong>
          <span style={{ fontSize: 14, color: C.textSecondary }}>
            {fmtAge(openedAt)} назад · {claim === undefined ? "смотрим заявку…" : claim?.decided ? (claim.refunded ? "WB вернул деньги" : "WB уже решил") : "ждёт вашего решения"}
          </span>
        </div>
      </div>
      {reason && (
        <div style={{ fontSize: 16, lineHeight: 1.4, background: "rgba(0,0,0,0.22)", borderRadius: 14, padding: "12px 14px", color: C.textPrimary }}>
          «{reason}»
        </div>
      )}

      {claim !== undefined && mode === "idle" && (
        <>
          {canAct && claim!.canReject && (
            <button type="button" className="twa-press" disabled={busy}
              onClick={() => { haptic.impact("light"); setMode("reject"); }}
              style={{ minHeight: 52, border: 0, borderRadius: 14, background: C.green, color: "#08210f", fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Check size={18} aria-hidden="true" /> Отклонить и выкупить
            </button>
          )}
          {/* Просто выкупить (владелец 27.11.2026): в WB ничего не уходит, заявку админ решает сам. */}
          <button type="button" className="twa-press-sm" disabled={busy}
            onClick={() => { haptic.select(); void send("keep"); }}
            style={{ minHeight: 46, borderRadius: 14, background: "rgba(48,209,88,0.12)", border: `1px solid ${C.green}66`, color: C.green, fontSize: 15, fontWeight: 600 }}>
            Просто выкупить · заявку решу сам
          </button>
          {canAct && claim!.canRefund && (
            <button type="button" className="twa-press-sm" disabled={busy}
              onClick={() => { haptic.select(); setMode("refund"); }}
              style={{ minHeight: 46, borderRadius: 14, background: "transparent", border: "1px solid rgba(255,105,97,0.45)", color: red, fontSize: 15, fontWeight: 600 }}>
              Вернуть деньги
            </button>
          )}
          <span style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.4 }}>
            Отказ уходит в WB с вашим комментарием. «Просто выкупить» в WB ничего не шлёт. В обоих случаях заказ в очереди. Возврат подтверждает заявку — заказ замораживается.
          </span>
        </>
      )}

      {canAct && mode === "reject" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {claim!.rejectNeedsComment && (
            <>
              {REASONS.map((r, i) => (
                <button key={r.label} type="button" className="twa-press-sm"
                  onClick={() => { haptic.select(); setReasonIdx(i); setComment(r.text); }}
                  style={{
                    textAlign: "left", minHeight: 46, borderRadius: 14, fontSize: 15, padding: "10px 14px", color: C.textPrimary,
                    border: i === reasonIdx ? `1.5px solid ${C.accent}` : `1px solid ${C.border}`,
                    background: i === reasonIdx ? `${C.accent}24` : "rgba(255,255,255,0.06)",
                  }}>
                  {r.label}
                </button>
              ))}
              <label htmlFor={`claim-comment-${code}`} style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>Комментарий — увидят покупатель и WB</label>
              <textarea id={`claim-comment-${code}`} rows={4} value={comment} maxLength={1000}
                onChange={(e) => setComment(e.target.value)}
                style={{ resize: "none", borderRadius: 14, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.25)", color: C.textPrimary, fontSize: 16, lineHeight: 1.4, padding: "12px 14px", fontFamily: "inherit" }} />
              <span style={{ fontSize: 13, color: C.textSecondary }}>{comment.trim().length} / 1000 · не короче 10</span>
            </>
          )}
          <button type="button" className="twa-press" disabled={busy} onClick={() => void send("reject")}
            style={{ minHeight: 52, border: 0, borderRadius: 14, background: C.green, color: "#08210f", fontSize: 17, fontWeight: 700 }}>
            {busy ? "Отправляем…" : "Отклонить в WB · заказ в очередь"}
          </button>
          <button type="button" onClick={() => setMode("idle")} style={{ minHeight: 44, border: 0, background: "none", color: C.textSecondary, fontSize: 16 }}>Отмена</button>
        </div>
      )}

      {canAct && mode === "refund" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 15, color: C.textPrimary }}>Деньги уйдут покупателю, выкупа не будет. Возврат снижает рейтинг магазина на WB.</span>
          <button type="button" className="twa-press" disabled={busy} onClick={() => void send("refund")}
            style={{ minHeight: 50, borderRadius: 14, border: 0, background: red, color: "#2a0705", fontSize: 16, fontWeight: 700 }}>
            {busy ? "Отправляем…" : "Да, вернуть деньги"}
          </button>
          <button type="button" onClick={() => setMode("idle")} style={{ minHeight: 44, border: 0, background: "none", color: C.textSecondary, fontSize: 16 }}>Отмена</button>
        </div>
      )}

      {note && (
        <span role="status" style={{ fontSize: 15, fontWeight: 600, color: note.ok ? C.green : red }}>{note.ok ? "✓ " : ""}{note.text}</span>
      )}

      {claim !== undefined && !canAct && mode === "idle" && (
        <span style={{ fontSize: 14, color: C.textSecondary }}>
          {claim?.decided ? "Решение по заявке уже принято — пометку можно снять «✓ Договорились»." : "WB не даёт ответить на эту заявку отсюда — решите её в кабинете WB."}
        </span>
      )}
    </section>
  );
}
