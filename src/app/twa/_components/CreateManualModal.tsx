"use client";
import { useEffect, useRef, useState } from "react";
import { C, MONO } from "./theme";
import { haptic } from "./haptics";
import { toast } from "./Toast";

/* ───────────── CreateManualModal (П4): ручное создание заказа ─────────────
   Общий для OrdersScreen (кнопка «+» у поиска) и BossrobuxScreen («➕» на
   карточке результата «Поиск и выкуп» — приходит с предзаполненным геймпассом).
   Внутри — обратная связка: поиск for-sale геймпассов по нику / ссылке на
   профиль (search-by-username), чтобы заказ можно было собрать не выходя из
   модалки. */

export interface RebindUser {
  id: string;
  tgId: string | null;
  vkId: string | null;
  username: string | null;
  name: string | null;
  robloxUsername: string | null;
}

interface ManualValidation {
  code?: { ok: boolean; error?: string; denomination?: number; claimedBy?: RebindUser | null };
  gamepass?: {
    error?: string;
    gamepassId?: string;
    livePrice?: number | null;
    isForSale?: boolean | null;
    expected?: number | null;
    priceMismatch?: boolean;
    sellerMatch?: boolean | null;
    existing?: { wbCode: string; status: string } | null;
  };
}

/** Результат поиска геймпассов по нику внутри модалки. */
interface FoundPass {
  gamepassId: number;
  name: string;
  price: number;
  existingOrder?: { wbCode: string; status: string } | null;
}

export type CreateOrderMode = "manual" | "direct";

const manualInputStyle: React.CSSProperties = {
  width: "100%", background: C.elevated, border: "none", borderRadius: 10,
  color: "#fff", fontSize: 15, padding: "11px 12px", outline: "none",
  fontFamily: "inherit", boxSizing: "border-box",
};

export default function CreateManualModal({ token, onDone, onClose, initialGamepassUrl, initialNick, initialAmount, mode = "manual" }: {
  token: string;
  onDone: () => void;
  onClose: () => void;
  initialGamepassUrl?: string;
  initialNick?: string;
  initialAmount?: number;
  mode?: CreateOrderMode;
}) {
  const isDirect = mode === "direct";
  const [wbCode, setWbCode] = useState("");
  const [amount, setAmount] = useState(initialAmount ? String(initialAmount) : "");
  const [nick, setNick] = useState(initialNick ?? "");
  const [gpInput, setGpInput] = useState(initialGamepassUrl ?? "");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [client, setClient] = useState<RebindUser | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<RebindUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [valid, setValid] = useState<ManualValidation>({});
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  // Поиск геймпассов по нику/ссылке на профиль — связка с «Поиск и выкуп».
  const [gpFound, setGpFound] = useState<FoundPass[]>([]);
  const [selectedDirectPass, setSelectedDirectPass] = useState<FoundPass | null>(null);
  const [gpSearching, setGpSearching] = useState(false);
  const [gpSearchMsg, setGpSearchMsg] = useState("");
  // 409-дедуп геймпасса: показываем существующий заказ, кнопка → «Создать всё равно».
  const [dup, setDup] = useState<{ wbCode: string; status: string } | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const validateDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // Поиск клиента — как в RebindModal (search-users).
  useEffect(() => {
    if (clientQuery.trim().length < 2) { setClientResults([]); return; }
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST", headers,
          body: JSON.stringify({ action: "search-users", query: clientQuery.trim() }),
        });
        const d = await r.json();
        if (r.ok && d.users) setClientResults(d.users);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(searchDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientQuery, token]);

  // Живая валидация кода/геймпасса (manual-validate) — не блокирует, подсвечивает.
  useEffect(() => {
    const codeTrim = wbCode.trim();
    const gpTrim = gpInput.trim();
    setDup(null);
    if (!codeTrim && !gpTrim) { setValid({}); return; }
    clearTimeout(validateDebounce.current);
    validateDebounce.current = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST", headers,
          body: JSON.stringify({
            action: "manual-validate",
            wbCode: codeTrim, gamepassUrl: gpTrim,
            robloxUsername: nick.trim(), amount: Number(amount) || undefined,
          }),
        });
        const d = await r.json();
        if (r.ok) setValid(d);
      } catch {}
      setChecking(false);
    }, 500);
    return () => clearTimeout(validateDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbCode, gpInput, nick, amount, token]);

  const codeState = wbCode.trim() ? valid.code : undefined;
  const gpState = gpInput.trim() ? valid.gamepass : undefined;
  const effAmount = codeState?.ok && codeState.denomination ? codeState.denomination : (Number(amount) || null);
  const canSubmit = isDirect
    ? !creating && !!client && !!nick.trim() && !!selectedDirectPass && !!gpInput.trim() && !gpState?.error
    : !creating && !!effAmount && (!wbCode.trim() || codeState?.ok === true) && (!gpInput.trim() || !gpState?.error);
  const expectedPrice = effAmount ? Math.ceil(effAmount / 0.7) : null;

  function userLabel(u: RebindUser) {
    const platform = u.tgId ? "TG" : u.vkId ? "VK" : "—";
    const name = u.username ? `@${u.username}` : u.name || u.tgId || u.vkId || u.id.slice(-6);
    return { platform, name };
  }

  // Поиск for-sale геймпассов ника (тот же роут, что «Поиск и выкуп»;
  // принимает @nick и ссылку roblox.com/users/<id>/profile).
  async function searchPassesByNick() {
    const q = nick.trim();
    if (!q || gpSearching) return;
    setGpSearching(true); setGpSearchMsg(""); setGpFound([]);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/roblox-account/purchase", {
        method: "POST", headers,
        body: JSON.stringify({ action: "search-by-username", username: q }),
      });
      const d = await r.json();
      if (!r.ok) { setGpSearchMsg(d.error ?? "Ошибка поиска"); return; }
      // Ссылку на профиль нормализуем в настоящий ник — он уйдёт в заказ.
      if (d.username && d.username !== q) setNick(d.username);
      const passes: FoundPass[] = d.gamepasses ?? [];
      setGpFound(passes);
      if (passes.length === 0) setGpSearchMsg(d.msg ?? "For-sale геймпассы не найдены");
    } catch { setGpSearchMsg("Ошибка сети"); }
    finally { setGpSearching(false); }
  }

  async function submit(force = false) {
    if (!canSubmit) return;
    setCreating(true);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST", headers,
        body: JSON.stringify({
          action: "create-manual",
          direct: isDirect,
          wbCode: wbCode.trim() || undefined,
          amount: Number(amount) || undefined,
          clientUserId: client?.id ?? undefined,
          robloxUsername: nick.trim() || undefined,
          gamepassUrl: gpInput.trim() || undefined,
          note: note.trim() || undefined,
          notify: !isDirect && notify && !!client,
          force,
        }),
      });
      const d = await r.json();
      if (r.status === 409 && d.existing) {
        haptic.notify("warning");
        setDup({ wbCode: d.existing.wbCode, status: d.existing.status });
        return;
      }
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      const created = d.order;
      let msg = `${isDirect ? "Прямой заказ" : "Заказ"} ${created.wbCode} создан · ${created.status === "PENDING" ? "К выкупу" : "Ждёт геймпасс"}`;
      if (!isDirect && notify && client) {
        msg += d.notified ? ` · клиент уведомлён (${String(d.notified).toUpperCase()})` : " · увед НЕ доставлен";
      }
      toast(msg, d.notified === null && !isDirect && notify && client ? "error" : "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setCreating(false); }
  }

  const warn = (text: string, color: string = C.orange) => (
    <div style={{ fontSize: 13, color, lineHeight: 1.35 }}>{text}</div>
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !creating) onClose(); }}
    >
      <div style={{
        background: C.card, borderRadius: 18, width: "100%", maxWidth: 400, maxHeight: "88vh",
        display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ padding: "18px 20px 4px", flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>{isDirect ? "🔷 Создать прямой заказ" : "➕ Создать заказ"}</div>
          <div style={{ fontSize: 13, color: C.textTertiary, marginTop: 4 }}>
            {isDirect
              ? "Найди геймпасс по нику и выбери юзера, с которым общался. Заказ сразу попадёт в «Прямой» и будет готов к выкупу."
              : "Ручной заказ: WB-код без заказа, восстановление, обмен."}
          </div>
        </div>

        <div style={{ padding: "12px 20px 8px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {/* Код ВБ — только для обычного ручного заказа. */}
          {!isDirect && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={wbCode}
              onChange={e => setWbCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7))}
              placeholder="Код ВБ (опц., 7 символов)"
              autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              style={{ ...manualInputStyle, fontFamily: MONO, letterSpacing: 2 }}
            />
            {codeState && !codeState.ok && warn(`✖ ${codeState.error}`, C.red)}
            {codeState?.ok && (
              <div style={{ fontSize: 13, color: C.green }}>
                ✓ Номинал <b>{codeState.denomination} R$</b>
                {codeState.claimedBy && (
                  <span style={{ color: C.textTertiary }}>
                    {" · активирован: "}{userLabel(codeState.claimedBy).name}
                  </span>
                )}
              </div>
            )}
          </div>}

          {/* Номинал — только без валидного кода */}
          {!isDirect && !codeState?.ok && (
            <input
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="Номинал R$ (если без кода)"
              inputMode="numeric"
              style={manualInputStyle}
            />
          )}

          {/* Клиент */}
          {client ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "9px 12px",
            }}>
              <span style={{
                fontSize: 11, fontWeight: 800, color: "#fff",
                background: userLabel(client).platform === "TG" ? "#229ED9" : "#0077FF",
                borderRadius: 4, padding: "3px 6px", flexShrink: 0,
              }}>{userLabel(client).platform}</span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {userLabel(client).name}
              </span>
              <button onClick={() => setClient(null)} style={{ background: "transparent", border: "none", color: C.textTertiary, fontSize: 17, cursor: "pointer", padding: 2 }}>✕</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={clientQuery}
                onChange={e => setClientQuery(e.target.value)}
                placeholder={isDirect ? "Юзер: @username, имя или ID" : "Клиент (опц.): @username, имя, ID"}
                style={manualInputStyle}
              />
              {searching && <div style={{ fontSize: 13, color: C.textTertiary }}>Поиск…</div>}
              {clientResults.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
                  {clientResults.map(u => {
                    const lbl = userLabel(u);
                    return (
                      <button key={u.id} className="twa-press-sm"
                        onClick={() => { haptic.impact("light"); setClient(u); setClientQuery(""); setClientResults([]); if (u.robloxUsername && !nick) setNick(u.robloxUsername); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%",
                          padding: "9px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                          background: "rgba(255,255,255,0.06)", textAlign: "left",
                        }}>
                        <span style={{
                          fontSize: 11, fontWeight: 800, color: "#fff",
                          background: lbl.platform === "TG" ? "#229ED9" : lbl.platform === "VK" ? "#0077FF" : C.elevated,
                          borderRadius: 4, padding: "3px 6px", flexShrink: 0,
                        }}>{lbl.platform}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lbl.name}</div>
                          {u.robloxUsername && <div style={{ fontSize: 12, color: C.textTertiary }}>🎮 {u.robloxUsername}</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Ник Roblox + поиск его for-sale геймпассов */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={nick}
                onChange={e => { setNick(e.target.value); setGpFound([]); setGpSearchMsg(""); setSelectedDirectPass(null); }}
                placeholder={isDirect ? "Ник Roblox — сначала найди геймпасс" : "Ник Roblox или ссылка на профиль (опц.)"}
                autoCapitalize="off" autoCorrect="off" spellCheck={false}
                style={{ ...manualInputStyle, flex: 1, width: "auto", minWidth: 0 }}
              />
              <button
                className="twa-press-sm"
                onClick={searchPassesByNick}
                disabled={gpSearching || nick.trim().length < 2}
                title="Найти for-sale геймпассы этого ника"
                style={{
                  flexShrink: 0, padding: "0 14px", border: "none", borderRadius: 10,
                  background: nick.trim().length >= 2 ? C.accent : C.elevated, color: "#fff",
                  fontSize: 15, fontWeight: 600, cursor: gpSearching ? "default" : "pointer",
                  opacity: gpSearching || nick.trim().length < 2 ? 0.5 : 1,
                  fontFamily: "inherit", transition: "all 0.2s",
                }}
              >
                {gpSearching ? "…" : "🔍"}
              </button>
            </div>
            {gpSearchMsg && <div style={{ fontSize: 13, color: C.textTertiary }}>{gpSearchMsg}</div>}
            {gpFound.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 170, overflowY: "auto" }}>
                {gpFound.map(gp => {
                  const priceOk = expectedPrice != null && Math.abs(gp.price - expectedPrice) <= 2;
                  return (
                    <button key={gp.gamepassId} className="twa-press-sm"
                      onClick={() => {
                        haptic.impact("light");
                        setGpInput(`https://www.roblox.com/game-pass/${gp.gamepassId}`);
                        setSelectedDirectPass(gp);
                        setAmount(String(Math.floor(gp.price * 0.7)));
                        setGpFound([]); setGpSearchMsg("");
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "9px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                        background: "rgba(255,255,255,0.06)", textAlign: "left",
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gp.name}</div>
                        {gp.existingOrder && (
                          <div style={{ fontSize: 12, color: C.orange }}>📦 уже в заказе {gp.existingOrder.wbCode}</div>
                        )}
                      </div>
                      <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 600, color: priceOk ? C.green : C.textSecondary }}>
                        {priceOk && "✓ "}{gp.price.toLocaleString("ru-RU")} R$
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Геймпасс */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={gpInput}
              onChange={e => { setGpInput(e.target.value); if (isDirect) setSelectedDirectPass(null); }}
              readOnly={isDirect}
              placeholder={isDirect ? "Выбери геймпасс из результатов поиска" : "Геймпасс: ссылка или ID (опц.)"}
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={manualInputStyle}
            />
            {gpState?.error && warn(`✖ ${gpState.error}`, C.red)}
            {gpState && !gpState.error && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {gpState.livePrice != null && (
                  <div style={{ fontSize: 13, color: gpState.priceMismatch ? C.orange : C.green }}>
                    {gpState.priceMismatch
                      ? `⚠️ Цена ГП ${gpState.livePrice} R$ ≠ расчётной ${gpState.expected} R$`
                      : `✓ Цена ГП ${gpState.livePrice} R$${gpState.expected ? ` (ожидается ${gpState.expected})` : ""}`}
                  </div>
                )}
                {gpState.isForSale === false && warn("⚠️ Геймпасс сейчас не в продаже")}
                {gpState.sellerMatch === false && warn("⚠️ Пасс не найден среди for-sale пассов этого ника")}
                {gpState.existing && warn(`⚠️ Уже в активном заказе ${gpState.existing.wbCode} (${gpState.existing.status})`)}
              </div>
            )}
            {checking && <div style={{ fontSize: 12, color: C.textTertiary }}>Проверяю…</div>}
            {isDirect && selectedDirectPass && (
              <div style={{ fontSize: 13, color: C.green }}>
                ✓ Клиенту: <b>{amount} R$</b> · цена пасса {selectedDirectPass.price.toLocaleString("ru-RU")} R$
              </div>
            )}
          </div>

          {/* Заметка */}
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Заметка (опц.)"
            style={manualInputStyle}
          />

          {/* Уведомить клиента */}
          {!isDirect && client && (
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />
              <span style={{ fontSize: 14, color: C.textSecondary }}>
                Уведомить клиента («код активирован → заказ в очереди»)
              </span>
            </label>
          )}

          {/* 409-дедуп: активный заказ на этот геймпасс */}
          {dup && (
            <div style={{
              padding: "9px 12px", background: `${C.orange}18`, borderRadius: 10,
              fontSize: 13, color: C.orange, lineHeight: 1.4,
            }}>
              ⚠️ На этот геймпасс уже есть активный заказ <b style={{ fontFamily: MONO }}>{dup.wbCode}</b> ({dup.status}).
              Нажми «Создать всё равно», если это осознанный повтор.
            </div>
          )}
        </div>

        <div style={{ padding: "10px 20px 18px", display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="twa-press" onClick={onClose} disabled={creating}
            style={{ flex: 1, padding: "13px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            Отмена
          </button>
          <button className="twa-press" onClick={() => submit(!!dup)} disabled={!canSubmit}
            style={{
              flex: 2, padding: "13px", borderRadius: 10, border: "none",
              background: dup ? C.orange : C.accent, color: "#fff",
              fontSize: 15, fontWeight: 600, cursor: "pointer",
              opacity: canSubmit ? 1 : 0.45,
            }}>
            {creating ? "…" : dup ? "Создать всё равно" : isDirect ? "Создать и поставить на выкуп" : "Создать заказ"}
          </button>
        </div>
      </div>
    </div>
  );
}
