"use client";

import BottomSheet from "./BottomSheet";
import { C } from "./theme";
import { haptic } from "./haptics";

/* ─────────────────────────────────────────────────────────────────────────────
   ✓ Подтверждение «Выкуплено» (16.11.2026, владелец: «при скролле я могу
   тапнуть на неё и выкупить заказ, даже не увидев»).

   Тап по «Выкуплено» в ленте, в карточке и в «Первым делом» открывает эту
   шторку: чей заказ, какой пасс, сколько списано — и только вторая кнопка
   закрывает заказ. Случайный тап при прокрутке максимум открывает шторку,
   клиенту ничего не уходит. Режим «Выкуп по одному» её не показывает: там
   «Выкуплено → дальше» нажимают осознанно и у него своя отмена.
   ───────────────────────────────────────────────────────────────────────── */

export interface ConfirmBuyoutInfo {
  code: string;
  nick: string | null;
  passIds: string[];
  /** Сколько спишется с аккаунта (цена пасса). */
  gross: number;
  /** Сколько получит клиент. */
  clean: number;
}

export default function ConfirmBuyoutSheet({ info, busy = false, onConfirm, onClose }: {
  info: ConfirmBuyoutInfo | null;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={Boolean(info)} onClose={onClose} ariaLabel="Подтвердить выкуп">
      {info && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 4px 8px" }}>
          <div style={{ fontSize: 15, color: C.textSecondary }}>Отметить выкупленным?</div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: "-.02em", overflowWrap: "anywhere" }}>{info.nick ?? "ник не указан"}</div>
            <div style={{ fontSize: 15, color: C.textSecondary, marginTop: 4, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{info.code}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0, borderRadius: 14, background: "rgba(255,255,255,.06)" }}>
            <Row label={info.passIds.length > 1 ? "Пассы" : "Пасс"} value={info.passIds.length > 0 ? info.passIds.join(", ") : "—"} mono />
            <Row label="Спишется" value={`${info.gross.toLocaleString("ru-RU")} R$`} />
            <Row label="Клиенту" value={`${info.clean.toLocaleString("ru-RU")} R$`} last />
          </div>
          <div style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.4 }}>
            Клиенту сразу уйдёт сообщение, что робуксы отправлены. Отменить его нельзя.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); onClose(); }}
              style={{ flex: 1, minHeight: 54, border: "none", borderRadius: 16, background: "rgba(255,255,255,.1)", color: C.textPrimary, fontSize: 17, fontWeight: 650, fontFamily: "inherit" }}>
              Отмена
            </button>
            <button type="button" className="twa-press-sm" disabled={busy} onClick={() => { haptic.impact("medium"); onConfirm(); }}
              style={{ flex: 1.4, minHeight: 54, border: "none", borderRadius: 16, background: "#30d158", color: "#04160b", fontSize: 17, fontWeight: 750, fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Отмечаю…" : "✓ Да, выкуплено"}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function Row({ label, value, mono = false, last = false }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 46, padding: "0 14px", borderBottom: last ? "none" : "1px solid rgba(255,255,255,.08)" }}>
      <span style={{ width: 86, fontSize: 15, color: C.textSecondary, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, overflowWrap: "anywhere", fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit" }}>{value}</span>
    </div>
  );
}
