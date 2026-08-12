"use client";
import { C, MONO, SHADOW, tabular, tint } from "../theme";
import { useEffect, useState, useCallback, useRef } from "react";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import CreateManualModal from "../CreateManualModal";
import { groupPartnerLedgerEntries, type PartnerLedgerRow } from "@/lib/partner-ledger";
import { computePartnerSettlement, partnerOrderRateUsdtPer1000, type PartnerRateBasisValue, type PartnerTaskEconomicSnapshot } from "@/lib/partner-economics";
/** Неоплаченный прямой заказ — исключается из всех путей выкупа (П5). */
import { isUnpaidDirect } from "@/lib/buyout-queue";
import { ChevronRight, CircleAlert, Droplets, History, KeyRound, MoreHorizontal, RefreshCw, Search, ShoppingBag } from "lucide-react";
import { bulkPause, shouldStopBatch, sleep } from "@/lib/buyout-batch";

interface AccountInfo {
  hasCookie:      boolean;
  cookieValid?:   boolean;
  cookieUpdatedAt: string | null;
  accountName:    string | null;
  accountId:      number | null;
  balance:        number | null;
  browserUnavailable?: boolean;
}

interface GamepassItem {
  gamepassId: number;
  productId:  number;
  name:       string;
  price:      number;
  sellerName: string;
  sellerId?:  number;
  image:      string | null;
  isForSale?: boolean;
  isManagedPricing?: boolean;
  basePriceInRobux?: number;
  /** Активный/выполненный заказ, уже ссылающийся на этот геймпасс (дедуп). */
  existingOrder?: { wbCode: string; status: string; orderSource: string; expectedPrice?: number } | null;
}

type BuyoutWorkspace = "own" | "anton";
type PartnerTaskStatus = "NEW" | "READY" | "PURCHASING" | "DONE" | "FAILED" | "CANCELLED";
type PartnerExternalSource = "MANUAL" | "GOOGLE_SHEETS" | "XLSX_UPLOAD";
type PartnerSubScreenKey = "bought" | "ledger" | "tasks";

interface PartnerSheetRaw {
  source?: string;
  spreadsheetId?: string;
  sheetTitle?: string;
  sheetId?: number | null;
  rowNumber?: number;
  range?: string;
  rowHash?: string;
  contentHash?: string;
  sheetPriceRobux?: number | null;
  sheetRateUsdtPer1000?: number | null;
  priceMismatch?: boolean;
  closedFromSheet?: boolean;
  importedDoneFromSheet?: boolean;
  rowDeletedFromSheet?: boolean;
  rowReusedForNewOrder?: boolean;
  rowReusedAt?: string | null;
  archivedRowId?: string | null;
  editedAfterDone?: { at?: string; before?: unknown[]; after?: unknown[] } | null;
  editedAfterDoneHash?: string | null;
  cancelledFromSheet?: boolean;
  cancelledByManager?: boolean;
  cancelledAt?: string | null;
  cancelWriteBackAt?: string | null;
  errorFromSheet?: boolean;
  conflict?: string | null;
  conflictAt?: string | null;
  reconciledAt?: string | null;
  syncedAt?: string;
  writeBackAt?: string | null;
  lastWriteBackError?: string | null;
  /** 5.8: id защиты A:D строки в Google Sheets (addProtectedRange). */
  protectedRangeId?: number | null;
  protectedAt?: string | null;
  pendingProtectedRangeId?: number | null;
  pendingProtectedAt?: string | null;
  protectError?: string | null;
  cells?: unknown[];
}

interface PartnerTask {
  id: string;
  status: PartnerTaskStatus;
  externalSource: PartnerExternalSource;
  externalRowId: string | null;
  robloxUsername: string | null;
  gamepassId: string | null;
  gamepassUrl: string | null;
  sellerName: string | null;
  priceRobux: number | null;
  purchasePriceRobux: number | null;
  purchaseAccountName: string | null;
  completedAt: string | null;
  error: string | null;
  note: string | null;
  sheetRaw: PartnerSheetRaw | null;
  economicSnapshot?: PartnerTaskEconomicSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

interface PartnerLedgerEntry {
  id: string;
  type: string;
  amount: number;
  currency: string;
  reference: string | null;
  comment: string | null;
  rateUsdtPer1000?: number | null;
  purchaseRateUsdtPer1000?: number | null;
  rateBasis?: PartnerRateBasisValue | null;
  costBasis?: string | null;
  robloxFeePct?: number | null;
  robuxAmount?: number | null;
  grossRobuxAmount?: number | null;
  netRobuxAmount?: number | null;
  revenueUsdt?: number | null;
  expectedRevenueUsdt?: number | null;
  costUsdt?: number | null;
  profitUsdt?: number | null;
  purchaseAccountName?: string | null;
  batchId?: string | null;
  itemCount?: number;
  taskId?: string | null;
  task?: { id: string; robloxUsername: string | null; gamepassId: string | null } | null;
  tasks?: Array<{ id: string; robloxUsername: string | null; gamepassId: string | null }>;
  createdAt: string;
}

interface PartnerSummary {
  balanceUsdt: number;
  spentUsdt: number;
  doneRobux: number;
  reservedUsdt: number;
  ledgerCurrency: string;
  robuxRateUsdtPer1000: number;
  purchaseRateUsdtPer1000: number;
  rateBasis: PartnerRateBasisValue;
  robloxFeePct: number;
  revenueUsdt: number;
  costUsdt: number | null;
  profitUsdt: number | null;
  grossRobux: number;
  netRobux: number;
  total: number;
  ready: number;
  purchasing: number;
  done: number;
  failed: number;
  mismatches?: number;
  conflicts?: number;
}

/** 5.9 A4: строка отчёта «по какому курсу сколько куплено» (rate=null — до бэкфилла). */
interface PartnerRateReportRow {
  rate: number | null;
  purchaseRate: number | null;
  rateBasis: PartnerRateBasisValue | null;
  buyouts: number;
  totalRobux: number;
  totalNetRobux: number;
  totalUsdt: number;
  revenueUsdt: number;
  costUsdt: number | null;
  profitUsdt: number | null;
}

interface PartnerRateChangeEntry {
  id: string;
  rate: number;
  previousRate: number | null;
  purchaseRate: number | null;
  previousPurchaseRate: number | null;
  rateBasis: PartnerRateBasisValue | null;
  previousRateBasis: PartnerRateBasisValue | null;
  robloxFeePct: number | null;
  createdBy: string | null;
  createdAt: string;
}

interface GoogleSyncFilterDiagnostics {
  readRows?: number;
  amountFilledRows?: number;
  pendingStatusRows?: number;
  matchedRows?: number;
  emptyAmountRows?: number;
  nonPendingStatusRows?: number;
  statusCounts?: Record<string, number>;
}

interface GoogleSyncSheetDiagnostics extends GoogleSyncFilterDiagnostics {
  title: string;
}

interface GoogleSyncReconciliationStats {
  closedFromSheet?: number;
  failedFromSheet?: number;
  cancelledFromSheet?: number;
  deletedFromSheet?: number;
  doneMarkedDeleted?: number;
  revived?: number;
  conflicts?: number;
  importedDone?: number;
  rowsReused?: number;
  reactivated?: number;
  editedAfterDone?: number;
}

interface GoogleSyncProtectionStats {
  locked?: number;
  healed?: number;
  unlocked?: number;
  failed?: number;
  pendingLocked?: number;
  pendingUnlocked?: number;
}

interface GoogleSyncDiagnostics extends GoogleSyncFilterDiagnostics {
  sheets?: GoogleSyncSheetDiagnostics[];
  reconciliation?: GoogleSyncReconciliationStats;
  protection?: GoogleSyncProtectionStats;
}

interface PartnerImportRun {
  id: string;
  status: string;
  source: PartnerExternalSource;
  spreadsheetId: string | null;
  sheetCount: number;
  rowCount: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  skippedCount: number;
  diagnostics: GoogleSyncDiagnostics | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdBy: string | null;
}

interface GoogleSyncResult {
  status: "skipped" | "success" | "partial" | "failed";
  message?: string;
  runId?: string;
  sheetCount?: number;
  rowCount?: number;
  created?: number;
  updated?: number;
  failed?: number;
  skipped?: number;
  diagnostics?: GoogleSyncDiagnostics | null;
  error?: string;
  errors?: string[];
}

interface PartnerState {
  partner: {
    id: string;
    slug: string;
    name: string;
    ledgerCurrency: string;
    robuxRateUsdtPer1000: number;
    purchaseRateUsdtPer1000: number;
    rateBasis: PartnerRateBasisValue;
    robloxFeePct: number;
    googleSheetUrl: string | null;
    googleSheetId: string | null;
    googleSheetTab: string | null;
  };
  tasks: PartnerTask[];
  ledgerEntries: PartnerLedgerEntry[];
  importRuns?: PartnerImportRun[];
  googleSync?: {
    configured: boolean;
    serviceAccountConfigured: boolean;
    lastSyncAt: string | null;
    latestRun: PartnerImportRun | null;
  };
  syncResult?: GoogleSyncResult;
  summary: PartnerSummary;
  rateReport?: PartnerRateReportRow[];
  rateChanges?: PartnerRateChangeEntry[];
}

interface PartnerImportResult {
  totalRows: number;
  created: number;
  skipped: number;
  failed: number;
  items: Array<{
    row: number;
    gamepassId: string | null;
    status: "created" | "skipped" | "failed";
    message: string;
  }>;
}

const ORDER_STATUS_RU: Record<string, string> = {
  AWAITING_GAMEPASS: "ждёт ГП",
  PENDING:           "в обработке",
  IN_PROGRESS:       "в работе",
  COMPLETED:         "выкуплен",
};

function SectionHeader({ title, hint, hintColor }: { title: string; hint?: string | null; hintColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, fontSize: 14, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, paddingLeft: 4 }}>
      <span>{title}</span>
      {hint && (
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, fontSize: 14, color: hintColor ?? C.textTertiary, paddingRight: 4 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

/** Ф2: возраст cookie для hero «Донор»; warn — жёлтая подсветка (>20 дн). */
function cookieAgeInfo(updatedAt: string | null): { text: string; warn: boolean } | null {
  if (!updatedAt) return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  const text = days === 0 ? "cookie обновлён сегодня" : `cookie обновлён ${days} дн назад`;
  return { text, warn: days > 20 };
}

/** Ф2: подпись виджета «Очередь» — сумма, «хватает на K из N», «ждут оплату M». */
function queueWidgetSub(s: OwnQueueStats | null): string | null {
  if (!s) return null;
  if (s.queue === 0) return s.awaitingPay > 0 ? `ждут оплату ${s.awaitingPay}` : "очередь пуста";
  const parts = [`${s.dirty.toLocaleString("ru-RU")} R$ грязными`];
  if (s.affordable !== null) parts.push(`хватает на ${s.affordable} из ${s.queue}`);
  if (s.awaitingPay > 0) parts.push(`ждут оплату ${s.awaitingPay}`);
  return parts.join(" · ");
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="twa-account-card" style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>{children}</div>;
}

function InfoRow({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", gap: 12 }}>
        <span style={{ fontSize: 16, color: C.textSecondary }}>{label}</span>
        <span style={{ fontSize: 16, color: "#e5e5ea", fontWeight: 500, fontFamily: "monospace", letterSpacing: 0.2 }}>{value}</span>
      </div>
      {!last && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
    </>
  );
}

function StatusDot({ valid }: { valid: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: valid ? C.green : C.red,
      boxShadow: `0 0 6px ${valid ? C.green : C.red}44`,
      marginRight: 8, verticalAlign: "middle",
    }} />
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "16px 16px", display: "flex", flexDirection: "column", gap: 20 }}>
      {[72, 100, 60].map((h, i) => (
        <div key={i} style={{ background: C.card, borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

// ── Segment Control ─────────────────────────────────────────────────────────
function SegmentControl({ value, onChange }: { value: "nick" | "id"; onChange: (v: "nick" | "id") => void }) {
  const opts: { id: "nick" | "id"; label: string }[] = [
    { id: "nick", label: "По нику" },
    { id: "id",   label: "По ID / URL" },
  ];
  return (
    <div style={{
      display: "flex", background: C.elevated, borderRadius: 10, padding: 3, gap: 2,
    }}>
      {opts.map(o => (
        <button
          key={o.id}
          className="twa-press-sm"
          onClick={() => { if (o.id !== value) { haptic.select(); onChange(o.id); } }}
          style={{
            flex: 1, padding: "10px 0", border: "none", borderRadius: 8, cursor: "pointer",
            fontSize: 15, fontWeight: 600, fontFamily: "inherit",
            background: value === o.id ? C.card : "transparent",
            color: value === o.id ? "#e5e5ea" : C.textTertiary,
            boxShadow: value === o.id ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
            transition: "all 0.2s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Gamepass Card ────────────────────────────────────────────────────────────
function GamepassCard({
  gp, buying, bought, onBuy, onCreateAvito, creatingAvito, onAttach, onCreateOrder, buyDisabled,
}: {
  gp: GamepassItem;
  buying: boolean;
  bought: boolean;
  onBuy: () => void;
  onCreateAvito?: () => void;
  creatingAvito?: boolean;
  onAttach?: () => void;
  /** ➕ Создать ручной заказ с этим геймпассом (CreateManualModal). */
  onCreateOrder?: () => void;
  /** Cookie не задан/истёк: поиск работает, выкуп — нет. */
  buyDisabled?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px",
      background: bought ? `${C.green}11` : "transparent",
      transition: "background 0.3s",
    }}>
      {gp.image && (
        <img
          src={gp.image}
          alt=""
          style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 16, fontWeight: 600, color: "#e5e5ea",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {gp.name}
        </div>
        <div style={{ fontSize: 14, color: C.textTertiary, marginTop: 2 }}>
          {gp.price.toLocaleString()} R$ · {gp.sellerName}
          {gp.isManagedPricing && <span style={{ color: C.orange }}> · MP</span>}
        </div>
        {gp.existingOrder && (
          <div style={{ fontSize: 13, fontWeight: 600, color: C.orange, marginTop: 3 }}>
            📦 уже в заказе {gp.existingOrder.wbCode} · {ORDER_STATUS_RU[gp.existingOrder.status] ?? gp.existingOrder.status}
            {/* Прайс-гард (Ш3): цена ≠ ожидаемой по номиналу заказа — сервер такой выкуп заблокирует */}
            {gp.existingOrder.expectedPrice != null && gp.existingOrder.expectedPrice !== gp.price && (
              <span style={{ color: C.red }}> · ⛔ нужна цена {gp.existingOrder.expectedPrice.toLocaleString("ru-RU")} R$</span>
            )}
          </div>
        )}
      </div>
      {bought ? (
        <span style={{ fontSize: 15, fontWeight: 600, color: C.green, flexShrink: 0 }}>✅</span>
      ) : (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {onAttach && (
            <button
              className="twa-press-sm"
              onClick={onAttach}
              title="Привязать к существующему заказу"
              style={{
                padding: "9px 12px", border: "none", borderRadius: 10,
                background: `${C.blue}22`, color: C.blue, fontSize: 15, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              📎
            </button>
          )}
          {onCreateOrder && (
            <button
              className="twa-press-sm"
              onClick={onCreateOrder}
              title="Создать ручной заказ с этим геймпассом"
              style={{
                padding: "9px 12px", border: "none", borderRadius: 10,
                background: `${C.accent}22`, color: C.accent, fontSize: 16, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
              }}
            >
              ＋
            </button>
          )}
          {onCreateAvito && (
            <button
              className="twa-press-sm"
              onClick={onCreateAvito}
              disabled={!!creatingAvito}
              style={{
                padding: "9px 14px", border: "none", borderRadius: 10,
                background: C.orange, color: "#fff", fontSize: 14, fontWeight: 600,
                cursor: creatingAvito ? "default" : "pointer",
                opacity: creatingAvito ? 0.5 : 1,
                fontFamily: "inherit", transition: "opacity 0.2s",
              }}
            >
              {creatingAvito ? "…" : "Авито"}
            </button>
          )}
          <button
            className="twa-press-sm"
            onClick={onBuy}
            disabled={buying || gp.isForSale === false || buyDisabled}
            title={buyDisabled ? "Cookie не задан/истёк — выкуп недоступен" : undefined}
            style={{
              padding: "9px 16px", border: "none", borderRadius: 10,
              background: gp.isForSale === false || buyDisabled ? C.elevated : C.green,
              color: "#fff", fontSize: 15, fontWeight: 600, cursor: buying ? "default" : "pointer",
              opacity: buying ? 0.5 : (gp.isForSale === false || buyDisabled ? 0.4 : 1),
              fontFamily: "inherit", transition: "opacity 0.2s",
            }}
          >
            {buying ? "…" : gp.isForSale === false ? "Не продаётся" : "🛒"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Confirm Modal ───────────────────────────────────────────────────────────
function ConfirmPurchase({
  gp, buying, onConfirm, onCancel,
}: {
  gp: GamepassItem;
  buying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}
      onClick={e => { if (e.target === e.currentTarget && !buying) onCancel(); }}
    >
      <div style={{
        background: C.card, borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 320,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          {gp.image && (
            <img src={gp.image} alt="" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 10 }} />
          )}
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>Купить «{gp.name}»?</div>
        </div>

        <div style={{ background: C.elevated, borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: "#e5e5ea", marginBottom: 6 }}>
            <span>Цена</span>
            <span style={{ fontWeight: 600 }}>{gp.price.toLocaleString()} R$</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>Продавец</span>
            <span>{gp.sellerName}</span>
          </div>
        </div>

        {gp.isManagedPricing && (
          <div style={{
            background: `${C.orange}18`, borderRadius: 10, padding: "10px 12px", marginBottom: 12,
            fontSize: 14, color: C.orange, fontWeight: 500,
          }}>
            ⚠️ Managed pricing · база {gp.basePriceInRobux?.toLocaleString()} R$, Roblox выставил {gp.price.toLocaleString()} R$
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="twa-press"
            onClick={onCancel}
            disabled={buying}
            style={{
              flex: 1, padding: "13px 0", border: "none", borderRadius: 12,
              background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Отмена
          </button>
          <button
            className="twa-press"
            onClick={onConfirm}
            disabled={buying}
            style={{
              flex: 1, padding: "13px 0", border: "none", borderRadius: 12,
              background: C.green, color: "#fff", fontSize: 15, fontWeight: 600,
              cursor: buying ? "default" : "pointer", fontFamily: "inherit",
              opacity: buying ? 0.6 : 1, transition: "opacity 0.2s",
            }}
          >
            {buying ? "Покупаю…" : "✅ Купить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Attach gamepass to an existing order (bot missed the link / rejected / error)
// ═════════════════════════════════════════════════════════════════════════════
interface AttachableOrder {
  id: string;
  wbCode: string;
  amount: number;
  status: string;
  platform: string;
  robloxUsername: string | null;
  gamepassUrl: string | null;
  createdAt: string;
  user: { tgId: string | null; vkId: string | null; name: string | null; username: string | null };
}

const ATTACH_STATUS_BADGE: Record<string, { label: string; color: string }> = {
  AWAITING_GAMEPASS: { label: "Ждёт ссылку", color: C.yellow },
  REJECTED:          { label: "Отклонён",    color: C.red },
  ERROR:             { label: "Ошибка",      color: C.red },
};

function AttachOrderModal({ gp, token, onClose, onAttached }: {
  gp: GamepassItem;
  token: string;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [orders, setOrders] = useState<AttachableOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<AttachableOrder | null>(null);
  const [attaching, setAttaching] = useState(false);

  // Server-side search: локальный список — только 50 свежих, старые заказы
  // (как MTXS3KS двухнедельной давности) ищутся по query в БД.
  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "attachable-orders", ...(q.length >= 2 ? { query: q } : {}) }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok) setOrders(d?.orders ?? []);
      else toast(d?.error ?? "Ошибка загрузки заказов", "error");
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    const q = filter.trim();
    const t = setTimeout(() => load(q), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [filter, load]);

  async function doAttach() {
    if (!selected || attaching) return;
    setAttaching(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "attach-gamepass", orderId: selected.id, gamepassId: String(gp.gamepassId) }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { haptic.notify("error"); toast(d?.error ?? "Ошибка", "error"); return; }
      if (d?.notified) {
        haptic.notify("success");
        toast(`📎 ${selected.wbCode} · привязан, клиент уведомлён (${d.notified === "tg" ? "TG" : "VK"})`, "success");
      } else {
        haptic.notify("warning");
        toast(`📎 ${selected.wbCode} · привязан, но уведомление НЕ доставлено — напиши клиенту вручную`, "error");
      }
      onAttached();
      onClose();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setAttaching(false); }
  }

  const f = filter.trim().toLowerCase();
  const shown = f
    ? orders.filter(o =>
        o.wbCode.toLowerCase().includes(f) ||
        (o.user.username ?? "").toLowerCase().includes(f) ||
        (o.user.name ?? "").toLowerCase().includes(f) ||
        (o.robloxUsername ?? "").toLowerCase().includes(f))
    : orders;

  const neededPrice = selected ? Math.ceil(selected.amount / 0.7) : null;
  const priceMismatch = selected !== null && neededPrice !== gp.price;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !attaching) onClose(); }}>
      <div style={{ background: C.card, borderRadius: 18, width: "100%", maxWidth: 380, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        {/* Header: gamepass summary */}
        <div style={{ padding: "18px 20px 12px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea", marginBottom: 6 }}>📎 Привязать к заказу</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {gp.image && <img src={gp.image} alt="" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#e5e5ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gp.name}</div>
              <div style={{ fontSize: 13, color: C.textTertiary }}>{gp.price.toLocaleString("ru-RU")} R$ · {gp.sellerName}</div>
            </div>
          </div>
        </div>

        {/* Filter */}
        <div style={{ padding: "0 20px 10px" }}>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Код ВБ, ник, имя…"
            style={{
              width: "100%", background: C.elevated, border: "none", borderRadius: 10,
              color: "#fff", fontSize: 15, padding: "10px 12px",
              outline: "none", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ height: 1, background: C.border }} />

        {/* Order list */}
        <div style={{ overflowY: "auto", flex: 1, opacity: loading && orders.length > 0 ? 0.5 : 1, transition: "opacity 0.15s" }}>
          {loading && orders.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 15 }}>Загружаю…</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 15 }}>
              {loading ? "Ищу…" : orders.length === 0 ? "Нет заказов, ожидающих геймпасс" : "Ничего не найдено"}
            </div>
          ) : shown.map((o, i) => {
            const isSel = selected?.id === o.id;
            const needed = Math.ceil(o.amount / 0.7);
            const match = needed === gp.price;
            const nick = o.user.username ? `@${o.user.username}` : o.user.name ?? "—";
            const sb = ATTACH_STATUS_BADGE[o.status];
            return (
              <div key={o.id}>
                {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 20 }} />}
                <button
                  className="twa-press"
                  onClick={() => { haptic.select(); setSelected(isSel ? null : o); }}
                  style={{
                    width: "100%", padding: "12px 20px", border: "none", cursor: "pointer",
                    background: isSel ? `${C.blue}14` : "transparent",
                    display: "flex", flexDirection: "column", gap: 5,
                    textAlign: "left", fontFamily: "inherit", transition: "background 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, width: "100%" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: "#fff",
                      background: o.user.tgId ? "#229ED9" : o.user.vkId ? "#0077FF" : C.elevated,
                      borderRadius: 4, padding: "2px 6px", flexShrink: 0,
                    }}>{o.user.tgId ? "T" : o.user.vkId ? "V" : "—"}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#7ec5ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{nick}</span>
                    {sb && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: sb.color, background: `${sb.color}1c`, padding: "2px 7px", borderRadius: 999, flexShrink: 0 }}>{sb.label}</span>
                    )}
                    <span style={{ fontSize: 13, color: ageColor(o.createdAt), marginLeft: "auto", flexShrink: 0, ...tabular }}>⏱ {fmtAge(o.createdAt)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, letterSpacing: 1, fontSize: 14 }}>{o.wbCode}</span>
                    <span style={{ fontSize: 14, color: match ? C.green : C.orange, marginLeft: "auto", ...tabular }}>
                      {match ? "✓" : "⚠️"} нужно {needed.toLocaleString("ru-RU")} R$
                    </span>
                  </div>
                  {isSel && <span style={{ fontSize: 12, color: C.textTertiary }}>({o.amount.toLocaleString("ru-RU")} чистых · заказ от {new Date(o.createdAt).toLocaleDateString("ru-RU")})</span>}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ height: 1, background: C.border }} />

        {/* Footer */}
        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          {priceMismatch && selected && (
            <div style={{ background: `${C.orange}18`, borderRadius: 10, padding: "8px 12px", fontSize: 13, color: C.orange }}>
              ⚠️ Цена ГП {gp.price.toLocaleString("ru-RU")} R$ ≠ требуемой {neededPrice?.toLocaleString("ru-RU")} R$ — проверь перед выкупом
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="twa-press" onClick={onClose} disabled={attaching}
              style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Отмена
            </button>
            <button className="twa-press" onClick={doAttach} disabled={!selected || attaching}
              style={{
                flex: 2, padding: "13px 0", border: "none", borderRadius: 12,
                background: selected ? C.blue : C.elevated, color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: !selected || attaching ? "default" : "pointer",
                fontFamily: "inherit", opacity: !selected || attaching ? 0.5 : 1, transition: "all 0.2s",
              }}>
              {attaching ? "Привязываю…" : selected ? `📎 Привязать · ${selected.wbCode}` : "Выбери заказ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Transaction History — accordion grouped by purchaserUsername (cookie account)
// ═════════════════════════════════════════════════════════════════════════════
interface TxOrder {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  robloxUsername: string | null;
  purchaserUsername: string | null;
  wbCode: string;
  isDirectOrder: boolean;
  orderSource: "WB" | "DIRECT" | "AVITO" | "MANUAL" | "SITE";
  createdAt: string;
  updatedAt: string;
  saleAmountKopecks: number | null;
  purchaseCostKopecks: number | null;
  profitKopecks: number | null;
  user: { tgId: string | null; vkId: string | null; name: string | null; username: string | null };
}

type TxSourceFilter = "ALL" | "WB" | "DIRECT" | "AVITO" | "MANUAL" | "SITE";
const TX_SOURCE_CHIPS: { id: TxSourceFilter; label: string; color: string }[] = [
  { id: "ALL",    label: "Все",     color: C.textPrimary },
  { id: "WB",     label: "WB",      color: C.green },
  { id: "DIRECT", label: "Прямой",  color: C.blue },
  { id: "AVITO",  label: "Авито",   color: C.orange },
];

const TX_SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  WB:     { label: "WB",     color: C.green },
  DIRECT: { label: "Прямой", color: C.blue },
  SITE:   { label: "Сайт",   color: C.blue },
  AVITO:  { label: "Авито",  color: C.orange },
  MANUAL: { label: "Ручной", color: C.textTertiary },
};

/** Слив остатка донора (DrainEvent) — показывается в истории вместе с выкупами. */
interface DrainEv {
  id: string;
  donorName: string | null;
  drainName: string | null;
  amount: number;
  createdAt: string;
}

interface PurchaserGroup {
  purchaser: string;
  orders: TxOrder[];
  drains: DrainEv[];
  /** Итог по аккаунту = выкупы + сливы (решение владельца: слив в общей трате). */
  totalDirty: number;
  drainTotal: number;
  latestDate: string;
}

function extractGpId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

function fmtTxDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

function pluralPurchases(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} покупка`;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} покупки`;
  return `${n} покупок`;
}

function buildGroups(orders: TxOrder[], sourceFilter: TxSourceFilter = "ALL", drains: DrainEv[] = []): PurchaserGroup[] {
  const filtered = sourceFilter === "ALL" ? orders : orders.filter(o => o.orderSource === sourceFilter);
  const map = new Map<string, TxOrder[]>();
  for (const o of filtered) {
    const key = o.purchaserUsername ?? "Ручные";
    const arr = map.get(key);
    if (arr) arr.push(o); else map.set(key, [o]);
  }
  // Сливы показываем только в «Все» — это не заказы, у них нет источника.
  const drainMap = new Map<string, DrainEv[]>();
  if (sourceFilter === "ALL") {
    for (const d of drains) {
      const key = d.donorName ?? "Ручные";
      const arr = drainMap.get(key);
      if (arr) arr.push(d); else drainMap.set(key, [d]);
      if (!map.has(key)) map.set(key, []); // донор без выкупов — своя группа
    }
  }
  const groups: PurchaserGroup[] = [];
  for (const [purchaser, ords] of map) {
    ords.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const grpDrains = (drainMap.get(purchaser) ?? [])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const buyoutTotal = ords.reduce((s, o) => s + Math.ceil(o.amount / 0.7), 0);
    const drainTotal = grpDrains.reduce((s, d) => s + d.amount, 0);
    groups.push({
      purchaser,
      orders: ords,
      drains: grpDrains,
      totalDirty: buyoutTotal + drainTotal,
      drainTotal,
      latestDate: [ords[0]?.updatedAt, grpDrains[0]?.createdAt].filter(Boolean).sort().reverse()[0] ?? new Date(0).toISOString(),
    });
  }
  groups.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  return groups;
}

function txCountBySource(orders: TxOrder[]): Record<TxSourceFilter, number> {
  const c: Record<string, number> = { ALL: orders.length, WB: 0, DIRECT: 0, AVITO: 0, MANUAL: 0 };
  for (const o of orders) c[o.orderSource] = (c[o.orderSource] ?? 0) + 1;
  return c as Record<TxSourceFilter, number>;
}

function PurchaserAccordion({ group }: { group: PurchaserGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
      {/* Header — always visible */}
      <button
        className="twa-press"
        onClick={() => { haptic.impact("light"); setOpen(v => !v); }}
        style={{
          width: "100%", padding: "14px 16px", border: "none", background: "transparent",
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          textAlign: "left", fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600, color: "#e5e5ea", flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          🎮 {group.purchaser}
        </span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.orange, ...tabular }}>
            − {group.totalDirty.toLocaleString("ru-RU")} R$
          </span>
          <span style={{ fontSize: 13, color: C.textTertiary }}>
            {pluralPurchases(group.orders.length)}
            {group.drainTotal > 0 && <> · <span style={{ color: C.blue }}>💧 {group.drainTotal.toLocaleString("ru-RU")}</span></>}
          </span>
        </div>
        <span style={{
          fontSize: 13, color: C.textTertiary, flexShrink: 0,
          transform: open ? "rotate(90deg)" : "none",
          transition: "transform 0.2s",
        }}>▶</span>
      </button>

      {/* Expanded: transaction rows */}
      {open && (
        <div>
          <div style={{ height: 1, background: C.border }} />
          {group.drains.map((d, i) => (
            <div key={d.id}>
              {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
              <div style={{ padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>{fmtTxDate(d.createdAt)}</span>
                <span style={{ fontSize: 13, color: C.blue }}>
                  💧 Слив → {d.drainName ?? "приёмник"}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, color: C.blue, ...tabular }}>
                  − {d.amount.toLocaleString("ru-RU")} R$
                </span>
              </div>
            </div>
          ))}
          {group.drains.length > 0 && group.orders.length > 0 && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
          {group.orders.map((tx, i) => {
            const dirty = Math.ceil(tx.amount / 0.7);
            const gpId = extractGpId(tx.gamepassUrl);
            const nick = tx.user.username ? `@${tx.user.username}` : tx.user.name ?? "—";
            const platform = tx.user.tgId ? "T" : tx.user.vkId ? "V" : "—";
            const platformColor = tx.user.tgId ? "#229ED9" : tx.user.vkId ? "#0077FF" : C.elevated;
            return (
              <div key={tx.id}>
                {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
                <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>{fmtTxDate(tx.updatedAt)}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.orange, ...tabular }}>
                      − {dirty.toLocaleString("ru-RU")} R$
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {tx.orderSource && tx.orderSource !== "WB" && (() => {
                      const sb = TX_SOURCE_BADGE[tx.orderSource];
                      if (!sb) return null;
                      return (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: sb.color,
                          background: `${sb.color}1c`, padding: "2px 6px",
                          borderRadius: 999, flexShrink: 0,
                        }}>{sb.label}</span>
                      );
                    })()}
                    {gpId && (
                      <span style={{ fontSize: 14, color: C.textSecondary, ...tabular }}>
                        Pass {gpId}
                      </span>
                    )}
                    {tx.robloxUsername && (
                      <span style={{ fontSize: 13, color: C.accent, fontWeight: 500 }}>
                        → {tx.robloxUsername}
                      </span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: "#fff",
                      background: platformColor, borderRadius: 4, padding: "2px 5px",
                      lineHeight: "15px",
                    }}>{platform}</span>
                    <span style={{
                      fontSize: 13, color: C.textTertiary,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{nick}</span>
                    <span style={{ fontSize: 13, color: C.textTertiary, fontFamily: MONO, letterSpacing: 0.3, marginLeft: "auto", flexShrink: 0 }}>
                      {tx.wbCode}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TransactionHistory({ token, onReady }: { token: string; onReady?: () => void }) {
  const [orders, setOrders] = useState<TxOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [profitSummary, setProfitSummary] = useState<{ kopecks: number; exactCount: number }>({ kopecks: 0, exactCount: 0 });
  const [sourceFilter, setSourceFilter] = useState<TxSourceFilter>("ALL");

  const load = useCallback(async (nextPage = 1, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ status: "DONE", limit: "20", page: String(nextPage), lite: "1" });
      if (sourceFilter !== "ALL") params.set("source", sourceFilter);
      if (append) params.set("skipCounts", "1");
      const response = await fetch(`/api/twa/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const data = await response.json();
      const batch: TxOrder[] = data.orders ?? [];
      setOrders(previous => append ? [...previous, ...batch] : batch);
      setPage(nextPage);
      setPages(data.pages ?? (batch.length === 20 ? nextPage + 1 : nextPage));
      if (!append) setTotal(data.total ?? batch.length);
      if (!append) setProfitSummary({
        kopecks: Number(data.profitSummary?._sum?.profitKopecks ?? 0),
        exactCount: Number(data.profitSummary?._count?.profitKopecks ?? 0),
      });
    } catch {}
    finally { setLoading(false); setLoadingMore(false); }
  }, [token, sourceFilter]);

  useEffect(() => { setOrders([]); load(1, false); }, [load]);

  useEffect(() => {
    if (loading || orders.length === 0 || !onReady) return;
    const frame = window.requestAnimationFrame(onReady);
    return () => window.cancelAnimationFrame(frame);
  }, [loading, onReady, orders.length]);

  if (loading) return (
    <div style={{ background: C.card, borderRadius: 14, height: 80, animation: "pulse 1.5s ease-in-out infinite" }} />
  );

  if (orders.length === 0) return (
    <Card>
      <div style={{ padding: "24px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 16, color: C.textTertiary }}>Нет завершённых покупок</div>
      </div>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="twa-no-scrollbar" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 1 }}>
          {TX_SOURCE_CHIPS.map(chip => {
            const isActive = sourceFilter === chip.id;
            return (
              <button
                key={chip.id}
                className="twa-press-sm"
                onClick={() => { haptic.select(); setSourceFilter(chip.id); }}
                style={{
                  padding: "6px 12px", border: "none", borderRadius: 999, cursor: "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 5,
                  background: isActive ? chip.color : C.elevated,
                  color: isActive ? "#fff" : chip.color,
                  opacity: isActive ? 1 : 0.7,
                  transition: "all 0.15s",
                }}
              >
                {chip.label}
              </button>
            );
          })}
      </div>

      {/* Summary */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px", background: tint(C.accent, 0.08), borderRadius: 12,
      }}>
        <span style={{ fontSize: 14, color: C.textSecondary }}>
          {total} покупок · показано {orders.length}
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.accent, ...tabular }}>
            {profitSummary.exactCount > 0 ? `${profitSummary.kopecks >= 0 ? "+" : ""}${(profitSummary.kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽` : "Точных данных нет"}
          </span>
          <span style={{ fontSize: 11, color: C.textTertiary }}>точная прибыль · {profitSummary.exactCount} заказов</span>
        </span>
      </div>

      <div className="twa-history-list">
        {orders.map(order => {
          const badge = TX_SOURCE_BADGE[order.orderSource] ?? TX_SOURCE_BADGE.MANUAL;
          const username = order.user.username ? `@${order.user.username}` : order.user.name ?? "—";
          return (
            <div className="twa-history-row" key={order.id}>
              <div className="twa-history-primary"><strong>{order.robloxUsername ?? "Ник не указан"}</strong><b>{order.amount.toLocaleString("ru-RU")} R$</b></div>
              <div className="twa-history-secondary"><code>{order.wbCode}</code><span>{username}</span><em style={{ color: badge.color }}>{badge.label}</em></div>
              <div className="twa-history-tertiary"><span>{fmtTxDate(order.updatedAt)}</span>{(order.orderSource === "DIRECT" || order.orderSource === "AVITO") && <b style={{ color: order.profitKopecks == null ? C.textTertiary : order.profitKopecks >= 0 ? C.green : C.red }}>{order.profitKopecks == null ? "нет точных данных" : `${order.profitKopecks >= 0 ? "+" : ""}${(order.profitKopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`}</b>}</div>
            </div>
          );
        })}
      </div>
      {page < pages && <button type="button" className="twa-primary-row twa-press" disabled={loadingMore} onClick={() => load(page + 1, true)}>{loadingMore ? "Загружаем…" : "Показать ещё"}</button>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Create Avito Order
// ═════════════════════════════════════════════════════════════════════════════
function CreateAvitoSection({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [saleRubles, setSaleRubles] = useState("");
  const [gpInput, setGpInput] = useState("");
  const [nick, setNick] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // Дедуп: сервер ответил 409 — активный заказ на этот геймпасс уже есть.
  const [dup, setDup] = useState<{ wbCode: string; status: string } | null>(null);

  async function submit(force = false) {
    const amt = parseInt(amount, 10);
    const sale = Number(saleRubles.replace(",", "."));
    if (!amt || amt < 1) { haptic.notify("error"); toast("Укажи сумму R$", "error"); return; }
    if (!Number.isFinite(sale) || sale <= 0) { haptic.notify("error"); toast("Укажи цену продажи в ₽", "error"); return; }
    setSaving(true);
    try {
      let gamepassUrl: string | null = null;
      const raw = gpInput.trim();
      if (raw) {
        if (raw.includes("roblox.com")) gamepassUrl = raw;
        else if (/^\d+$/.test(raw)) gamepassUrl = `https://www.roblox.com/game-pass/${raw}`;
        else gamepassUrl = raw;
      }

      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "create-avito",
          amount: amt,
          saleRubles: sale,
          gamepassUrl,
          robloxUsername: nick.trim() || null,
          note: note.trim() || null,
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
      toast(`Заказ Авито создан · ${amt} R$`, "success");
      setAmount(""); setSaleRubles(""); setGpInput(""); setNick(""); setNote(""); setDup(null);
      setOpen(false);
      onCreated();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button
        className="twa-press"
        onClick={() => { haptic.impact("light"); setOpen(true); }}
        style={{
          width: "100%", padding: "14px", border: `1px dashed ${C.orange}55`,
          borderRadius: 14, background: `${C.orange}0a`, cursor: "pointer",
          fontSize: 15, fontWeight: 600, color: C.orange,
          fontFamily: "inherit",
        }}
      >
        + Авито заказ
      </button>
    );
  }

  return (
    <Card>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.orange }}>Новый заказ Авито</span>
          <button className="twa-press-sm" onClick={() => { setOpen(false); }}
            style={{ background: "transparent", border: "none", fontSize: 14, color: C.textTertiary, cursor: "pointer", padding: "4px 8px" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
            placeholder="Сумма R$"
            inputMode="numeric"
            style={{
              flex: 1, background: C.elevated, border: "none", borderRadius: 10,
              color: "#fff", fontSize: 16, padding: "12px 14px",
              outline: "none", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
          <input
            value={saleRubles}
            onChange={e => setSaleRubles(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="Продали, ₽"
            inputMode="decimal"
            style={{
              flex: 1, background: C.elevated, border: "none", borderRadius: 10,
              color: "#fff", fontSize: 16, padding: "12px 14px",
              outline: "none", fontFamily: "inherit", boxSizing: "border-box", minWidth: 0,
            }}
          />
        </div>

        <input
          value={gpInput}
          onChange={e => { setGpInput(e.target.value); setDup(null); }}
          placeholder="ID или URL геймпасса (опционально)"
          style={{
            width: "100%", background: C.elevated, border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "12px 14px",
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />

        <input
          value={nick}
          onChange={e => setNick(e.target.value)}
          placeholder="Ник Roblox продавца (опционально)"
          style={{
            width: "100%", background: C.elevated, border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "12px 14px",
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />

        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Заметка (опционально)"
          style={{
            width: "100%", background: C.elevated, border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "12px 14px",
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />

        {dup && (
          <div style={{
            padding: "10px 12px", borderRadius: 10, background: `${C.orange}18`,
            fontSize: 14, color: C.orange, lineHeight: 1.4,
          }}>
            ⚠️ Этот геймпасс уже в заказе <b>{dup.wbCode}</b>{" "}
            ({ORDER_STATUS_RU[dup.status] ?? dup.status}). Нажми «Создать всё равно»,
            если нужен второй заказ.
          </div>
        )}

        <button
          className="twa-press"
          onClick={() => submit(!!dup)}
          disabled={saving || !amount.trim() || !saleRubles.trim()}
          style={{
            width: "100%", padding: "14px", border: "none", borderRadius: 12,
            background: amount.trim() && saleRubles.trim() ? C.orange : C.elevated,
            color: "#fff", fontSize: 16, fontWeight: 600, cursor: saving ? "default" : "pointer",
            opacity: saving || !amount.trim() || !saleRubles.trim() ? 0.5 : 1,
            fontFamily: "inherit", transition: "all 0.2s",
          }}
        >
          {saving ? "Создаю…" : dup ? "Создать всё равно" : "Создать заказ Авито"}
        </button>
      </div>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Buyout Orders Section (embedded in Account)
// ═════════════════════════════════════════════════════════════════════════════
interface BuyoutOrder {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  status: string;
  wbCode: string;
  isDirectOrder: boolean;
  orderSource: string;
  robloxUsername: string | null;
  createdAt: string;
  pendingAt: string | null;
  paidAt: string | null;
  buyoutErrorCode: string | null;
  user: { tgId: string | null; vkId: string | null; name: string | null; username: string | null };
}

/** Живая проверка геймпасса карточки (П5): фактическая цена + «уже выкупался». */
interface GpLiveInfo {
  expected: number;
  livePrice: number | null;
  basePrice: number | null;
  isForSale: boolean | null;
  priceMismatch: boolean;
  robloxPlusDiscountPercent: number | null;
  hasUnsafeBuyerPrice: boolean;
  reusedIn: string | null;
}


function fmtAge(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 1) return "< 1 мин";
  if (mins < 60) return `${Math.round(mins)} мин`;
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d === 0) return `${h}ч`;
  const rem = h % 24;
  return rem > 0 ? `${d}д ${rem}ч` : `${d}д`;
}

function ageColor(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 120) return C.green;
  if (mins < 720) return C.yellow;
  if (mins < 1440) return "#ff9500";
  return C.red;
}

function sortByAge(a: BuyoutOrder, b: BuyoutOrder) {
  const pA = new Date(a.pendingAt ?? a.createdAt).getTime();
  const pB = new Date(b.pendingAt ?? b.createdAt).getTime();
  if (pA !== pB) return pA - pB;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

const MAX_REMAINDER_DIRTY = 143;

function buyoutCost(order: BuyoutOrder, liveMap: Record<string, GpLiveInfo>): number {
  const expected = Math.ceil(order.amount / 0.7);
  const live = liveMap[order.id];
  return live?.robloxPlusDiscountPercent && live.livePrice != null && !live.priceMismatch && !live.hasUnsafeBuyerPrice
    ? live.livePrice
    : expected;
}

function optimizeWbSubset(wbOrders: BuyoutOrder[], budget: number, liveMap: Record<string, GpLiveInfo>) {
  const n = wbOrders.length;
  const d = wbOrders.map(o => buyoutCost(o, liveMap));
  const total = d.reduce((a, b) => a + b, 0);
  if (total <= budget) return { selectedIdx: new Set(d.map((_, i) => i)), targetSum: total };

  const cap = Math.min(budget, 300_000);
  const reversed = [...d].reverse();

  const snaps: Uint8Array[] = [new Uint8Array(cap + 1)];
  snaps[0][0] = 1;
  for (let i = 0; i < n; i++) {
    const prev = snaps[i];
    const curr = new Uint8Array(prev);
    const di = reversed[i];
    for (let s = cap; s >= di; s--) {
      if (prev[s - di]) curr[s] = 1;
    }
    snaps.push(curr);
  }

  const final = snaps[n];
  let bestSum = -1;
  for (let s = Math.min(cap, budget); s >= Math.max(0, budget - MAX_REMAINDER_DIRTY); s--) {
    if (final[s]) { bestSum = s; break; }
  }
  if (bestSum < 0) {
    for (let s = Math.min(cap, budget); s >= 0; s--) {
      if (final[s]) { bestSum = s; break; }
    }
  }
  if (bestSum <= 0) return { selectedIdx: new Set<number>(), targetSum: 0 };

  const revSelected: number[] = [];
  let s = bestSum;
  for (let i = n - 1; i >= 0; i--) {
    if (s >= reversed[i] && snaps[i][s - reversed[i]]) {
      revSelected.push(i);
      s -= reversed[i];
    }
  }

  const selectedIdx = new Set(revSelected.map(ri => n - 1 - ri));
  return { selectedIdx, targetSum: bestSum };
}

function buildBuyoutPlan(orders: BuyoutOrder[], balance: number, liveMap: Record<string, GpLiveInfo>) {
  const { direct, avito, wb } = groupBySource(orders);
  direct.sort(sortByAge);
  avito.sort(sortByAge);
  wb.sort(sortByAge);

  const mandatoryDirty = [...direct, ...avito].reduce((s, o) => s + buyoutCost(o, liveMap), 0);
  const wbBudget = balance - mandatoryDirty;

  let selectedWb: BuyoutOrder[];
  let waitingWb: BuyoutOrder[];
  let wbDirtyUsed: number;

  if (wbBudget <= 0) {
    selectedWb = [];
    waitingWb = wb;
    wbDirtyUsed = 0;
  } else {
    const totalWbDirty = wb.reduce((s, o) => s + buyoutCost(o, liveMap), 0);
    if (totalWbDirty <= wbBudget) {
      selectedWb = wb;
      waitingWb = [];
      wbDirtyUsed = totalWbDirty;
    } else {
      const { selectedIdx, targetSum } = optimizeWbSubset(wb, wbBudget, liveMap);
      selectedWb = wb.filter((_, i) => selectedIdx.has(i));
      waitingWb = wb.filter((_, i) => !selectedIdx.has(i));
      wbDirtyUsed = targetSum;
    }
  }

  const totalDirty = mandatoryDirty + wbDirtyUsed;
  return {
    selected: [...direct, ...avito, ...selectedWb],
    waiting: waitingWb,
    totalDirty,
    remainingBalance: balance - totalDirty,
  };
}

function groupBySource(orders: BuyoutOrder[]) {
  const direct = orders.filter(o => o.isDirectOrder && o.orderSource !== "AVITO");
  const avito = orders.filter(o => o.orderSource === "AVITO");
  const wb = orders.filter(o => !o.isDirectOrder && o.orderSource !== "AVITO");
  return { direct, avito, wb };
}

function BuyoutOrderCard({
  order, buying, onPurchase, dimmed, live,
}: { order: BuyoutOrder; buying: string | null; onPurchase: (o: BuyoutOrder) => void; dimmed?: boolean; live?: GpLiveInfo }) {
  const dirty = live?.robloxPlusDiscountPercent && live.livePrice != null && !live.priceMismatch && !live.hasUnsafeBuyerPrice
    ? live.livePrice
    : Math.ceil(order.amount / 0.7);
  const nick = order.user.username ? `@${order.user.username}` : order.user.name ?? "—";
  const isBuying = buying === order.id;
  const plusBlocked = Boolean(live?.robloxPlusDiscountPercent && !live?.hasUnsafeBuyerPrice);
  return (
    <div className="twa-buyout-row" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, opacity: dimmed ? 0.45 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, color: "#fff",
            background: order.user.tgId ? "#229ED9" : order.user.vkId ? "#0077FF" : C.elevated,
            borderRadius: 5, padding: "4px 8px", flexShrink: 0,
          }}>
            {order.user.tgId ? "T" : order.user.vkId ? "V" : "—"}
          </span>
          <span style={{
            fontSize: 17, fontWeight: 600, color: "#7ec5ff",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{nick}</span>
          {order.orderSource === "AVITO" ? (
            <span style={{
              fontSize: 12, fontWeight: 600, color: C.orange,
              background: `${C.orange}1c`, padding: "4px 9px",
              borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
            }}>Авито</span>
          ) : order.isDirectOrder && (
            <span style={{
              fontSize: 12, fontWeight: 600, color: C.blue,
              background: `${C.blue}1c`, padding: "4px 9px",
              borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
            }}>Прямой</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: ageColor(order.createdAt), ...tabular }}>
            ⏱ {fmtAge(order.createdAt)}
          </span>
          {order.pendingAt && (
            <span title="В очереди «К выкупу»"
              style={{ fontSize: 15, fontWeight: 500, color: ageColor(order.pendingAt), ...tabular }}>
              🛒 {fmtAge(order.pendingAt)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#e5e5ea", ...tabular }}>
            {dirty.toLocaleString("ru-RU")}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>R$</span>
          <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>
            ({order.amount.toLocaleString("ru-RU")})
          </span>
        </div>
        {order.gamepassUrl && !dimmed && (
          <button
            className="twa-press"
            onClick={() => onPurchase(order)}
            disabled={!!buying || plusBlocked}
            title={plusBlocked ? "Для этого donor нужен официальный Roblox client flow или аккаунт без Plus" : undefined}
            style={{
              padding: "10px 18px", border: "none", borderRadius: 10,
              background: plusBlocked ? "rgba(255,159,10,0.14)" : "rgba(48,209,88,0.14)",
              color: plusBlocked ? C.orange : "#30d158",
              fontSize: 15, fontWeight: 600, cursor: "pointer",
              opacity: isBuying ? 0.5 : plusBlocked ? 0.8 : 1,
            }}
          >
            {isBuying ? "⏳…" : plusBlocked ? "Нужен donor без Plus" : "Выкупить"}
          </button>
        )}
      </div>

      {/* П5: честная карточка — фактическая живая цена ГП и «уже выкупался» */}
      {live?.priceMismatch && live.livePrice != null && (
        <div style={{ fontSize: 13, fontWeight: 600, color: C.orange }}>
          ⚠️ Фактическая цена пасса {live.livePrice.toLocaleString("ru-RU")} R$ ≠ расчётной {live.expected.toLocaleString("ru-RU")} R$
        </div>
      )}
      {live?.robloxPlusDiscountPercent && live.livePrice != null && live.basePrice != null && (
        <div style={{ fontSize: 13, fontWeight: 600, color: C.green }}>
          ✨ Roblox Plus −{live.robloxPlusDiscountPercent}%: списание {live.livePrice.toLocaleString("ru-RU")} R$, база продавца {live.basePrice.toLocaleString("ru-RU")} R$
        </div>
      )}
      {live?.hasUnsafeBuyerPrice && (
        <div style={{ fontSize: 13, fontWeight: 600, color: C.red }}>
          ⛔ Неизвестная/региональная buyer-цена — сервер заблокирует покупку
        </div>
      )}
      {live?.isForSale === false && (
        <div style={{ fontSize: 13, fontWeight: 600, color: C.red }}>
          ⛔ Геймпасс сейчас не на продаже
        </div>
      )}
      {live?.reusedIn && (
        <div style={{ fontSize: 13, fontWeight: 600, color: C.red }}>
          ♻️ Уже выкупался в {live.reusedIn} — донор может им владеть
        </div>
      )}
      {order.robloxUsername && (
        <div style={{ fontSize: 15, color: C.textSecondary }}>
          🎮 {order.robloxUsername}
        </div>
      )}
      {order.wbCode && (
        <div style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, letterSpacing: 1.5, fontSize: 15 }}>
          📦 {order.wbCode}
        </div>
      )}
    </div>
  );
}

function renderGroupedOrders(
  orders: BuyoutOrder[], buying: string | null, onPurchase: (o: BuyoutOrder) => void, dimmed?: boolean,
  liveMap?: Record<string, GpLiveInfo>,
) {
  const { direct, avito, wb } = groupBySource(orders);
  const groups: { label: string; color: string; items: BuyoutOrder[] }[] = [];
  if (direct.length) groups.push({ label: "Прямые", color: C.blue, items: direct });
  if (avito.length) groups.push({ label: "Авито", color: C.orange, items: avito });
  if (wb.length) groups.push({ label: "WB", color: C.green, items: wb });

  const multiGroup = groups.length > 1;
  let idx = 0;
  return groups.map((g, gi) => (
    <div key={g.label}>
      {gi > 0 && <div style={{ height: 2, background: C.border, margin: "6px 0" }} />}
      {multiGroup && (
        <div style={{ padding: "10px 16px 4px", fontSize: 12, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {g.label} · {g.items.length}
        </div>
      )}
      {g.items.map((order, oi) => {
        const showSep = multiGroup ? oi > 0 : idx > 0;
        idx++;
        return (
          <div key={order.id}>
            {showSep && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
            <BuyoutOrderCard order={order} buying={buying} onPurchase={onPurchase} dimmed={dimmed} live={liveMap?.[order.id]} />
          </div>
        );
      })}
    </div>
  ));
}

interface BatchItem { orderId: string; nick: string; wbCode: string; gross: number; ok: boolean; reason?: string; }
// Пауза и условия остановки — в `@/lib/buyout-batch`, общие с веб-админкой:
// два экрана не должны расходиться в том, когда пачку пора прекращать.

function buyoutNick(o: BuyoutOrder): string {
  return o.user.username ? `@${o.user.username}` : o.user.name ?? "—";
}

/** Ф2: статы очереди для виджета «Очередь» дашборда «Свои». */
interface OwnQueueStats { queue: number; dirty: number; affordable: number | null; awaitingPay: number }

function BuyoutSection({ token, balance, accountName, onBalanceChange, onStats }: { token: string; balance: number | null; accountName: string | null; onBalanceChange: (delta: number) => void; onStats?: (s: OwnQueueStats) => void }) {
  const [orders, setOrders] = useState<BuyoutOrder[]>([]);
  // Неоплаченные DIR (П5): не в очереди — отдельная свёрнутая секция «Ждём оплату».
  const [awaitingPay, setAwaitingPay] = useState<BuyoutOrder[]>([]);
  const [liveMap, setLiveMap] = useState<Record<string, GpLiveInfo>>({});
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; ok: number } | null>(null);
  const [report, setReport] = useState<{ items: BatchItem[]; total: number; ok: number; fail: number } | null>(null);
  const bulkStop = useRef(false);

  // Живая проверка ГП карточек (фактическая цена, «уже выкупался») — после
  // загрузки списка, не блокируя его; ошибки не критичны.
  const checkLive = useCallback(async (list: BuyoutOrder[]) => {
    const ids = list.filter(o => o.gamepassUrl).map(o => o.id).slice(0, 30);
    if (ids.length === 0) return;
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "gp-live-check", orderIds: ids }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.results) setLiveMap(d.results);
    } catch { /* non-fatal */ }
  }, [token]);

  const load = useCallback(async () => {
    try {
      const hdrs = { Authorization: `Bearer ${token}` };
      const [rDirect, rBuyout, rAvito] = await Promise.all([
        fetch(`/api/twa/orders?status=DIRECT&limit=50&lite=1`, { headers: hdrs }),
        fetch(`/api/twa/orders?status=BUYOUT&limit=50&lite=1`, { headers: hdrs }),
        fetch(`/api/twa/orders?status=AVITO&limit=50&lite=1`, { headers: hdrs }),
      ]);
      const direct = rDirect.ok ? ((await rDirect.json()).orders ?? []) : [];
      const buyout = rBuyout.ok ? ((await rBuyout.json()).orders ?? []) : [];
      const avito = rAvito.ok ? ((await rAvito.json()).orders ?? []) : [];
      // С 2026-07-25 оплаченный прямой заказ приходит и в BUYOUT, и в DIRECT
      // (вкладка «Прямой» — срез по источнику), поэтому склейку дедуплицируем по id.
      const all: BuyoutOrder[] = [...new Map<string, BuyoutOrder>(
        [...direct, ...buyout, ...avito].map(o => [o.id, o]),
      ).values()];
      // REGIONAL_PRICE rows are included: gp-live-check now distinguishes a
      // typed Roblox Plus discount from an actually unsafe buyer price.
      const queue = all.filter(o => !isUnpaidDirect(o));
      setOrders(queue);
      setAwaitingPay(all.filter(isUnpaidDirect));
      void checkLive(all);
    } catch {}
    finally { setLoading(false); }
  }, [token, checkLive]);

  useEffect(() => { load(); }, [load]);

  // Ф2: виджет «Очередь» — статы наверх при каждом изменении очереди/баланса.
  useEffect(() => {
    if (!onStats) return;
    const dirty = orders.reduce((s, o) => s + buyoutCost(o, liveMap), 0);
    const affordable = balance === null ? null : buildBuyoutPlan(orders, balance, liveMap).selected.length;
    onStats({ queue: orders.length, dirty, affordable, awaitingPay: awaitingPay.length });
  }, [orders, awaitingPay, balance, liveMap, onStats]);

  async function doPurchase(order: BuyoutOrder) {
    if (buying) return;
    setBuying(order.id);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "purchase", orderId: order.id }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      if (d.success) {
        haptic.notify("success");
        toast(`✅ ${d.msg}`, "success");
        const charged = Number(d.chargedPrice ?? buyoutCost(order, liveMap));
        onBalanceChange(-charged);
        setOrders(prev => prev.filter(o => o.id !== order.id));
      } else {
        haptic.notify("error");
        toast(`❌ ${d.msg}`, "error");
        if (d.failureCode === "REGIONAL_PRICE") {
          setOrders(prev => prev.filter(o => o.id !== order.id));
          await load();
        }
      }
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setBuying(null); }
  }

  // ── Bulk buyout: purchase the whole selected plan one by one, with jitter ──
  async function doBulk(queue: BuyoutOrder[]) {
    if (bulkRunning || queue.length === 0) return;
    setBulkRunning(true);
    bulkStop.current = false;
    setBulkProgress({ done: 0, total: queue.length, ok: 0 });
    const items: BatchItem[] = [];
    const startedAt = new Date().toISOString();
    let ok = 0;

    // Прогрессивная запись батча: закрытие TWA сразу после пачки раньше убивало
    // единственный финальный fetch — отчёт терялся (кейс «1 отчёт из 3 акков»).
    // Теперь батч создаётся ДО первой покупки, item'ы дозаписываются по ходу,
    // а недофинишированные батчи дошлёт свипер TG-бота.
    let batchId: string | null = null;
    try {
      const r = await fetch("/api/twa/purchase-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "start", accountName, startedAt }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.batchId) batchId = d.batchId;
    } catch { /* батч-трекинг не должен блокировать выкуп */ }

    async function pushItem(item: BatchItem) {
      if (!batchId) return;
      try {
        await fetch("/api/twa/purchase-batch", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "item", batchId, item }),
        });
      } catch { /* item переживёт — finish/свипер восстановят из клиентского списка */ }
    }

    let remaining = [...queue];
    let localBalance = balance ?? Number.MAX_SAFE_INTEGER;
    let processed = 0;
    while (remaining.length > 0) {
      if (bulkStop.current) break;
      // Rebuild the affordable pack after every result. A REGIONAL_PRICE row
      // spends nothing, so a previously waiting order may enter immediately.
      const next = buildBuyoutPlan(remaining, localBalance, liveMap).selected[0];
      if (!next) break;
      const order = next;
      remaining = remaining.filter(o => o.id !== order.id);
      let gross = buyoutCost(order, liveMap);
      const nick = buyoutNick(order);
      if (processed > 0) await sleep(bulkPause());
      if (bulkStop.current) break;
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "purchase", orderId: order.id }),
        });
        const d = await r.json().catch(() => null);
        if (r.ok && d?.success) {
          ok++;
          gross = Number(d.chargedPrice ?? gross);
          localBalance -= gross;
          onBalanceChange(-gross);
          setOrders(prev => prev.filter(o => o.id !== order.id));
          items.push({ orderId: order.id, nick, wbCode: order.wbCode, gross, ok: true });
          await pushItem(items[items.length - 1]);
          haptic.impact("light");
        } else {
          const reason = d?.msg ?? d?.error ?? (r.ok ? "не куплено" : `HTTP ${r.status}`);
          items.push({ orderId: order.id, nick, wbCode: order.wbCode, gross, ok: false, reason });
          await pushItem(items[items.length - 1]);
          if (d?.failureCode === "REGIONAL_PRICE") {
            setOrders(prev => prev.filter(o => o.id !== order.id));
          }
          if (shouldStopBatch(reason)) { bulkStop.current = true; }
        }
      } catch {
        items.push({ orderId: order.id, nick, wbCode: order.wbCode, gross, ok: false, reason: "ошибка сети" });
        await pushItem(items[items.length - 1]);
      }
      processed++;
      setBulkProgress({ done: processed, total: queue.length, ok });
    }

    const fail = items.length - ok;
    const total = items.filter(x => x.ok).reduce((s, x) => s + x.gross, 0);
    setBulkRunning(false);
    setBulkProgress(null);
    setReport({ items, total, ok, fail });
    haptic.notify(fail === 0 ? "success" : "warning");

    // Финализация + отчёт менеджеру. keepalive — запрос переживает закрытие
    // TWA; await — не показываем отчёт раньше, чем он ушёл. Если start не
    // долетел (batchId нет) — легаси-путь save одним запросом.
    try {
      await fetch("/api/twa/purchase-batch", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(
          batchId
            ? { action: "finish", batchId, items, notify: true }
            : { action: "save", accountName, startedAt, items, notify: true }
        ),
      });
    } catch { /* отчёт дошлёт свипер TG-бота по недофинишированному батчу */ }
    await load();
  }

  if (loading) return (
    <div style={{ background: C.card, borderRadius: 14, height: 80, animation: "pulse 1.5s ease-in-out infinite" }} />
  );

  // Свёрнутая секция неоплаченных DIR — видна во всех состояниях очереди.
  const awaitingPayBlock = awaitingPay.length > 0
    ? <AwaitingPaySection orders={awaitingPay} liveMap={liveMap} />
    : null;

  if (orders.length === 0) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Card>
        <div style={{ padding: "20px 16px", textAlign: "center", color: C.textTertiary, fontSize: 16 }}>
          Нет заказов к выкупу
        </div>
      </Card>
      {awaitingPayBlock}
    </div>
  );

  if (balance === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Card>{renderGroupedOrders(orders, buying, doPurchase, false, liveMap)}</Card>
        {awaitingPayBlock}
      </div>
    );
  }

  const plan = buildBuyoutPlan(orders, balance, liveMap);
  const waitingDirty = plan.waiting.reduce((s, o) => s + buyoutCost(o, liveMap), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Summary bar */}
      <div className="twa-buyout-summary">
      <Card>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Баланс</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea", ...tabular }}>
              {balance.toLocaleString("ru-RU")} <span style={{ fontSize: 14, color: C.accent }}>R$</span>
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Пачка</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: C.green, ...tabular }}>
              {plan.selected.length} из {orders.length} · {plan.totalDirty.toLocaleString("ru-RU")} R$
            </span>
          </div>
          {plan.waiting.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, color: C.textSecondary }}>Ожидают</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: C.orange, ...tabular }}>
                {plan.waiting.length} шт · {waitingDirty.toLocaleString("ru-RU")} R$
              </span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Остаток</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: plan.remainingBalance <= MAX_REMAINDER_DIRTY ? C.green : C.textSecondary, ...tabular }}>
              {plan.remainingBalance.toLocaleString("ru-RU")} R$
            </span>
          </div>
        </div>
      </Card>
      </div>

      {/* Bulk buyout control */}
      {plan.selected.length > 0 && (
        bulkRunning ? (
          <Card>
            <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#e5e5ea" }}>
                  Выкупаю {bulkProgress?.done ?? 0}/{bulkProgress?.total ?? 0}…
                </div>
                <div style={{ fontSize: 13, color: C.green, marginTop: 2, ...tabular }}>
                  ✅ {bulkProgress?.ok ?? 0} успешно
                </div>
              </div>
              <button className="twa-press" onClick={() => { haptic.impact("medium"); bulkStop.current = true; }}
                style={{ padding: "10px 18px", border: "none", borderRadius: 10, background: `${C.red}22`, color: C.red, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                ⏹ Стоп
              </button>
            </div>
          </Card>
        ) : (
          <button className="twa-press" onClick={() => { haptic.impact("medium"); doBulk(orders); }} disabled={!!buying}
            style={{ width: "100%", padding: "15px", border: "none", borderRadius: 14, background: C.green, color: "#fff", fontSize: 16, fontWeight: 700, cursor: buying ? "default" : "pointer", opacity: buying ? 0.5 : 1, fontFamily: "inherit" }}>
            ⚡ Выкупить всё ({plan.selected.length} · {plan.totalDirty.toLocaleString("ru-RU")} R$)
          </button>
        )
      )}

      {/* Selected — ready to buy */}
      {plan.selected.length > 0 && (
        <Card>
          <div style={{ padding: "10px 16px 4px", fontSize: 12, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Выкупить · {plan.selected.length}
          </div>
          {renderGroupedOrders(plan.selected, buying, doPurchase, false, liveMap)}
        </Card>
      )}

      {/* Waiting — not enough balance */}
      {plan.waiting.length > 0 && (
        <Card>
          <div style={{ padding: "10px 16px 4px", fontSize: 12, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Ожидают баланс · {plan.waiting.length}
          </div>
          {renderGroupedOrders(plan.waiting, buying, doPurchase, true, liveMap)}
        </Card>
      )}

      {awaitingPayBlock}

      {report && (
        <BulkReport report={report} onClose={() => setReport(null)} />
      )}
    </div>
  );
}

// ── Неоплаченные прямые заказы (П5) — свёрнутая секция «💳 Ждём оплату» ──────
// Кнопки выкупа нет намеренно: до подтверждения оплаты (pay_ok в TG) заказ
// исключён из очереди, пачки и «Выкупить всё»; сервер такие действия отвергает.
function AwaitingPaySection({ orders, liveMap }: { orders: BuyoutOrder[]; liveMap: Record<string, GpLiveInfo> }) {
  const [open, setOpen] = useState(false);
  const totalDirty = orders.reduce((s, o) => s + Math.ceil(o.amount / 0.7), 0);
  return (
    <Card>
      <button
        className="twa-press"
        onClick={() => { haptic.impact("light"); setOpen(v => !v); }}
        style={{
          width: "100%", padding: "13px 16px", border: "none", background: "transparent",
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          textAlign: "left", fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: C.yellow, textTransform: "uppercase", letterSpacing: 0.5, flex: 1 }}>
          💳 Ждём оплату · {orders.length}
        </span>
        <span style={{ fontSize: 13, color: C.textTertiary, ...tabular }}>
          {totalDirty.toLocaleString("ru-RU")} R$
        </span>
        <span style={{ fontSize: 12, color: C.textTertiary, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>
      {open && orders.map(o => (
        <div key={o.id}>
          <div style={{ height: 1, background: C.border, marginLeft: 16 }} />
          <BuyoutOrderCard order={o} buying={null} onPurchase={() => {}} dimmed live={liveMap[o.id]} />
        </div>
      ))}
      {open && (
        <div style={{ padding: "4px 16px 12px", fontSize: 12, color: C.textTertiary }}>
          Прямые заказы без подтверждённой оплаты — в очередь выкупа попадут после «✅ Оплата пришла» в TG-карточке.
        </div>
      )}
    </Card>
  );
}

// ── Bulk buyout report modal ──────────────────────────────────────────────────
function BulkReport({ report, onClose }: {
  report: { items: BatchItem[]; total: number; ok: number; fail: number };
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.card, borderRadius: 18, width: "100%", maxWidth: 380, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "18px 20px 12px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea", marginBottom: 8 }}>🧾 Отчёт выкупа</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.green, background: `${C.green}1c`, padding: "4px 10px", borderRadius: 999 }}>✅ {report.ok}</span>
            {report.fail > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: C.red, background: `${C.red}1c`, padding: "4px 10px", borderRadius: 999 }}>❌ {report.fail}</span>}
            <span style={{ fontSize: 13, fontWeight: 600, color: C.accent, background: `${C.accent}1c`, padding: "4px 10px", borderRadius: 999, ...tabular }}>− {report.total.toLocaleString("ru-RU")} R$</span>
          </div>
        </div>
        <div style={{ height: 1, background: C.border }} />
        <div style={{ overflowY: "auto", padding: "8px 0" }}>
          {report.items.map((it, i) => (
            <div key={it.orderId + i} style={{ padding: "8px 20px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{it.ok ? "✅" : "❌"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "#e5e5ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.nick}</div>
                <div style={{ fontSize: 12, color: C.textTertiary, fontFamily: MONO }}>{it.wbCode}{!it.ok && it.reason ? ` · ${it.reason}` : ""}</div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: it.ok ? C.orange : C.textTertiary, flexShrink: 0, ...tabular }}>
                {it.ok ? `− ${it.gross.toLocaleString("ru-RU")}` : "—"}
              </span>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: C.border }} />
        <div style={{ padding: "12px 20px" }}>
          <button className="twa-press" onClick={onClose}
            style={{ width: "100%", padding: "13px", border: "none", borderRadius: 12, background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Готово
          </button>
          <div style={{ fontSize: 12, color: C.textTertiary, textAlign: "center", marginTop: 8 }}>
            Отчёт сохранён и отправлен в Telegram
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Drain (слив остатка донора → мой аккаунт)
// ═════════════════════════════════════════════════════════════════════════════
interface DrainInfo {
  drain: {
    hasCookie: boolean; cookieValid: boolean | null; cookieUpdatedAt: string | null;
    accountName: string | null; accountId: number | null; balance: number | null;
  };
  donor: { hasCookie: boolean; accountName: string | null; balance: number | null };
  gamepass: {
    gamepassId: number; productId?: number; name?: string; price?: number;
    isForSale?: boolean; sellerName?: string | null; error?: string;
  } | null;
  gamepasses?: { gamepassId: number; name: string; price: number | null; isForSale: boolean }[];
}

function DrainConfirm({ target, drainName, donorName, draining, onConfirm, onCancel }: {
  target: number; drainName: string | null; donorName: string | null;
  draining: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget && !draining) onCancel(); }}>
      <div style={{ background: C.card, borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💧</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>Слить остаток?</div>
        </div>
        <div style={{ background: C.elevated, borderRadius: 12, padding: "14px 16px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: "#e5e5ea" }}>
            <span>Сумма</span><span style={{ fontWeight: 700 }}>{target.toLocaleString("ru-RU")} R$</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>Донор</span><span>{donorName ?? "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>Приёмник</span><span>{drainName ?? "—"}</span>
          </div>
        </div>
        <div style={{ background: `${C.orange}18`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: C.orange }}>
          Цена геймпасса приёмника станет {target.toLocaleString("ru-RU")} R$, донор его купит на весь баланс. Займёт ~15–30 c.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="twa-press" onClick={onCancel} disabled={draining}
            style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Отмена
          </button>
          <button className="twa-press" onClick={onConfirm} disabled={draining}
            style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: draining ? "default" : "pointer", fontFamily: "inherit", opacity: draining ? 0.6 : 1 }}>
            {draining ? "Сливаю…" : "💧 Слить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DrainSection({ token, onDonorBalance }: { token: string; onDonorBalance?: (b: number | null) => void }) {
  const [d, setD] = useState<DrainInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [draining, setDraining] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [gpInput, setGpInput] = useState("");
  const [savingCookie, setSavingCookie] = useState(false);
  const [savingGp, setSavingGp] = useState(false);

  const hdrs = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/twa/drain", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setD(await r.json());
    } catch {}
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function saveCookie() {
    if (!cookieInput.trim()) return;
    setSavingCookie(true);
    try {
      const r = await fetch("/api/twa/drain", { method: "POST", headers: hdrs, body: JSON.stringify({ action: "set-cookie", cookie: cookieInput.trim() }) });
      const j = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(j.error ?? "Ошибка", "error"); return; }
      haptic.notify("success"); toast(`Приёмник · ${j.accountName}`, "success");
      setCookieInput(""); await load();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setSavingCookie(false); }
  }

  async function saveGp(idOverride?: string) {
    const gamepassId = (idOverride ?? gpInput).trim();
    if (!gamepassId) return;
    setSavingGp(true);
    try {
      const r = await fetch("/api/twa/drain", { method: "POST", headers: hdrs, body: JSON.stringify({ action: "set-gamepass", gamepassId }) });
      const j = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(j.error ?? "Ошибка", "error"); return; }
      haptic.notify("success"); toast(`Геймпасс · ${j.name}`, "success");
      setGpInput(""); await load();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setSavingGp(false); }
  }

  async function doDrain() {
    setDraining(true);
    try {
      const r = await fetch("/api/twa/drain", { method: "POST", headers: hdrs, body: JSON.stringify({ action: "drain" }) });
      const j = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(j.error ?? "Ошибка", "error"); return; }
      if (j.success) { haptic.notify("success"); toast(`💧 ${j.msg}`, "success"); }
      else { haptic.notify("error"); toast(`❌ ${j.msg}`, "error"); }
      setConfirm(false);
      if (j.donorBalanceAfter !== undefined) onDonorBalance?.(j.donorBalanceAfter);
      // Балансы из ответа применяем сразу — не ждём полного refetch (PLAN +5.G.1).
      if (j.donorBalanceAfter !== undefined || j.drainBalanceAfter !== undefined) {
        setD(prev => prev ? {
          ...prev,
          donor: { ...prev.donor, balance: j.donorBalanceAfter ?? prev.donor.balance },
          drain: { ...prev.drain, balance: j.drainBalanceAfter ?? prev.drain.balance },
        } : prev);
      }
      await load();
    } catch { haptic.notify("error"); toast("Ошибка сети — слив мог не завершиться", "error"); }
    finally { setDraining(false); }
  }

  if (loading) return (
    <div style={{ background: C.card, borderRadius: 14, height: 80, animation: "pulse 1.5s ease-in-out infinite" }} />
  );

  const target = d?.donor.balance ?? 0;
  const gp = d?.gamepass;
  const gpReady = !!gp?.productId;
  const canDrain = !!d?.drain.hasCookie && d.drain.cookieValid !== false && gpReady && target > 0 && !!d?.donor.hasCookie;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Card>
        {d?.drain.hasCookie ? (
          <>
            <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <StatusDot valid={d.drain.cookieValid !== false} />
              <span style={{ fontSize: 17, fontWeight: 600, color: "#e5e5ea" }}>{d.drain.accountName ?? "Приёмник"}</span>
              {d.drain.cookieValid === false && <span style={{ fontSize: 13, color: C.red }}>Cookie истёк</span>}
            </div>
            <div style={{ height: 1, background: C.border, marginLeft: 16 }} />
            <InfoRow label="Баланс приёмника" value={d.drain.balance !== null ? `${d.drain.balance.toLocaleString("ru-RU")} R$` : "—"} />
            <InfoRow label="К сливу (донор)" value={
              d.donor.balance !== null
                ? <span style={{ color: target > 0 ? C.accent : C.textTertiary }}>{d.donor.balance.toLocaleString("ru-RU")} R$</span>
                : "—"
            } />
            <InfoRow label="Геймпасс" last value={
              gp
                ? (gpReady ? `${gp.name} · ${gp.price?.toLocaleString("ru-RU")} R$${gp.isForSale ? "" : " · не продаётся"}` : (gp.error ?? "ошибка"))
                : "не задан"
            } />
          </>
        ) : (
          <div style={{ padding: "20px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💧</div>
            <div style={{ fontSize: 16, color: C.textSecondary }}>Аккаунт-приёмник не задан</div>
            <div style={{ fontSize: 14, color: C.textTertiary, marginTop: 4 }}>Настройте cookie и геймпасс ниже</div>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", gap: 8 }}>
        {canDrain && (
          <button className="twa-press" onClick={() => { haptic.impact("medium"); setConfirm(true); }}
            style={{ flex: 1, background: C.accent, border: "none", borderRadius: 12, color: "#fff", fontSize: 15, fontWeight: 700, padding: "14px", cursor: "pointer" }}>
            💧 Слить остаток ({target.toLocaleString("ru-RU")} R$)
          </button>
        )}
        <button className="twa-press" onClick={() => { haptic.impact("light"); load(); }} disabled={loading}
          aria-label="Обновить балансы"
          style={{ flex: "none", background: C.card, border: "none", borderRadius: 12, color: C.textSecondary, fontSize: 15, fontWeight: 600, padding: "14px 16px", cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          ↻
        </button>
        <button className="twa-press" onClick={() => { haptic.impact("light"); setShowConfig(v => !v); }}
          style={{ flex: canDrain ? "none" : 1, background: C.card, border: "none", borderRadius: 12, color: showConfig ? C.orange : C.textSecondary, fontSize: 15, fontWeight: 600, padding: "14px 18px", cursor: "pointer" }}>
          ⚙️ Настройка
        </button>
      </div>

      {showConfig && (
        <Card>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: C.textTertiary, marginBottom: 6, paddingLeft: 2 }}>Cookie аккаунта-приёмника (.ROBLOSECURITY)</div>
              <textarea value={cookieInput} onChange={e => setCookieInput(e.target.value)} placeholder=".ROBLOSECURITY значение…" rows={3}
                style={{ width: "100%", background: C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "12px 14px", resize: "vertical", outline: "none", fontFamily: "monospace", lineHeight: 1.4, boxSizing: "border-box" }} />
              <button className="twa-press" onClick={() => { haptic.impact("medium"); saveCookie(); }} disabled={savingCookie || !cookieInput.trim()}
                style={{ marginTop: 8, width: "100%", background: cookieInput.trim() ? C.green : C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px", cursor: savingCookie ? "default" : "pointer", opacity: savingCookie || !cookieInput.trim() ? 0.5 : 1 }}>
                {savingCookie ? "Проверяю…" : "💾 Сохранить cookie приёмника"}
              </button>
            </div>
            <div style={{ height: 1, background: C.border }} />
            <div>
              <div style={{ fontSize: 13, color: C.textTertiary, marginBottom: 6, paddingLeft: 2 }}>ID / URL геймпасса на аккаунте-приёмнике</div>
              <input value={gpInput} onChange={e => setGpInput(e.target.value)} placeholder="ID или URL геймпасса…"
                style={{ width: "100%", background: C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "12px 14px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
              <button className="twa-press" onClick={() => { haptic.impact("medium"); saveGp(); }} disabled={savingGp || !gpInput.trim()}
                style={{ marginTop: 8, width: "100%", background: gpInput.trim() ? C.green : C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px", cursor: savingGp ? "default" : "pointer", opacity: savingGp || !gpInput.trim() ? 0.5 : 1 }}>
                {savingGp ? "Проверяю…" : "💾 Сохранить геймпасс"}
              </button>

              {d?.gamepasses && d.gamepasses.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: C.textTertiary, marginBottom: 6, paddingLeft: 2 }}>
                    или выберите свой геймпасс:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                    {d.gamepasses.map(gp => {
                      const selected = d.gamepass?.gamepassId === gp.gamepassId;
                      return (
                        <button key={gp.gamepassId} className="twa-press" disabled={savingGp}
                          onClick={() => { haptic.impact("light"); saveGp(String(gp.gamepassId)); }}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                            background: selected ? `${C.accent}1c` : C.elevated,
                            border: selected ? `1px solid ${C.accent}` : "1px solid transparent",
                            borderRadius: 10, padding: "10px 12px", cursor: savingGp ? "default" : "pointer",
                            textAlign: "left", fontFamily: "inherit",
                          }}>
                          <span style={{ fontSize: 14, color: "#e5e5ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {selected ? "✓ " : ""}{gp.name}
                          </span>
                          <span style={{ fontSize: 13, color: gp.isForSale ? C.accent : C.textTertiary, flexShrink: 0, ...tabular }}>
                            {gp.price != null ? `${gp.price.toLocaleString("ru-RU")} R$` : "—"}{gp.isForSale ? "" : " · off"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {confirm && (
        <DrainConfirm
          target={target}
          drainName={d?.drain.accountName ?? null}
          donorName={d?.donor.accountName ?? null}
          draining={draining}
          onConfirm={doDrain}
          onCancel={() => { if (!draining) setConfirm(false); }}
        />
      )}
    </div>
  );
}

function WorkspaceSwitch({ value, onChange }: { value: BuyoutWorkspace; onChange: (v: BuyoutWorkspace) => void }) {
  const opts: { id: BuyoutWorkspace; label: string }[] = [
    { id: "own", label: "Свои" },
    { id: "anton", label: "Антон" },
  ];
  return (
    <div className="twa-account-workspace" style={{ display: "flex", background: C.elevated, borderRadius: 12, padding: 3, gap: 3 }}>
      {opts.map(o => (
        <button
          key={o.id}
          className="twa-press-sm"
          onClick={() => { if (o.id !== value) { haptic.select(); onChange(o.id); } }}
          style={{
            flex: 1,
            minHeight: 42,
            border: "none",
            borderRadius: 9,
            cursor: "pointer",
            fontSize: 15,
            fontWeight: 700,
            fontFamily: "inherit",
            background: value === o.id ? C.card : "transparent",
            color: value === o.id ? "#e5e5ea" : C.textTertiary,
            boxShadow: value === o.id ? "0 1px 3px rgba(0,0,0,0.28)" : "none",
            transition: "background 0.18s, color 0.18s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const PARTNER_STATUS: Record<PartnerTaskStatus, { label: string; color: string }> = {
  NEW: { label: "Новая", color: C.textTertiary },
  READY: { label: "Готова", color: C.accent },
  PURCHASING: { label: "Покупка", color: C.orange },
  DONE: { label: "Готово", color: C.green },
  FAILED: { label: "Ошибка", color: C.red },
  CANCELLED: { label: "Отмена", color: C.textTertiary },
};

function fmtPartnerDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtUsdt(value: number | null | undefined) {
  return `${(value ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

function partnerTaskCostUsdt(
  priceRobux: number | null | undefined,
  rate: number,
  rateBasis: PartnerRateBasisValue = "DIRTY",
  robloxFeePct = 30,
) {
  if (!priceRobux) return 0;
  return computePartnerSettlement({
    grossRobux: priceRobux,
    saleRateUsdtPer1000: rate,
    purchaseRateUsdtPer1000: 1,
    rateBasis,
    robloxFeePct,
  }).revenueUsdt;
}

function partnerTaskRate(task: Pick<PartnerTask, "sheetRaw">, fallbackRate: number) {
  return partnerOrderRateUsdtPer1000(task.sheetRaw, fallbackRate);
}

function fmtSyncAgo(value: string | null | undefined) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "обновлено только что";
  if (mins < 60) return `обновлено ${mins} мин назад`;
  return `обновлено ${Math.floor(mins / 60)} ч назад`;
}

function PartnerActionButton({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="twa-press-sm"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        minHeight: 38,
        border: "none",
        borderRadius: 9,
        background: disabled ? C.elevated : color,
        color: "#fff",
        fontSize: 14,
        fontWeight: 700,
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}

function PartnerTaskRow({
  task,
  busy,
  rateUsdtPer1000,
  rateBasis,
  robloxFeePct,
  onPurchase,
  onMarkDone,
  onCancel,
}: {
  task: PartnerTask;
  busy: boolean;
  rateUsdtPer1000: number;
  rateBasis: PartnerRateBasisValue;
  robloxFeePct: number;
  onPurchase: (task: PartnerTask) => void;
  onMarkDone: (task: PartnerTask) => void;
  onCancel: (task: PartnerTask) => void;
}) {
  const status = PARTNER_STATUS[task.status];
  const canPurchase = task.status === "READY" || task.status === "FAILED";
  const canClose = task.status !== "DONE" && task.status !== "CANCELLED" && task.status !== "PURCHASING";
  const title = task.sellerName || task.robloxUsername || (task.gamepassId ? `ГП ${task.gamepassId}` : "Геймпасс");
  const price = task.priceRobux ?? task.purchasePriceRobux;
  const taskRate = task.economicSnapshot?.saleRateUsdtPer1000 ?? partnerTaskRate(task, rateUsdtPer1000);
  const costUsdt = task.economicSnapshot?.revenueUsdt
    ?? partnerTaskCostUsdt(price, taskRate, rateBasis, robloxFeePct);
  const googleRow = task.externalSource === "GOOGLE_SHEETS" && task.sheetRaw?.sheetTitle && task.sheetRaw?.rowNumber
    ? `${task.sheetRaw.sheetTitle}:${task.sheetRaw.rowNumber}`
    : null;
  const sourceLabel = task.externalSource === "GOOGLE_SHEETS"
    ? (googleRow ? `Google ${googleRow}` : "Google")
    : task.externalSource === "XLSX_UPLOAD"
      ? "XLSX"
      : "Manual";
  // Прямая ссылка на строку таблицы (sheetId=gid сохраняется в sheetRaw при sync).
  const sheetRowLink = task.externalSource === "GOOGLE_SHEETS"
    && task.sheetRaw?.spreadsheetId && task.sheetRaw?.sheetId != null && task.sheetRaw?.rowNumber
    ? `https://docs.google.com/spreadsheets/d/${task.sheetRaw.spreadsheetId}/edit#gid=${task.sheetRaw.sheetId}&range=A${task.sheetRaw.rowNumber}`
    : null;
  const writeBackError = task.sheetRaw?.lastWriteBackError || null;
  const isClosedTask = task.status === "DONE" || task.status === "CANCELLED";
  // 5.7 C2: строку правили после выкупа — задача не мутирует, показываем diff A:C.
  const editedAfterDone = task.sheetRaw?.editedAfterDone ?? null;
  const editedDiff = editedAfterDone
    ? `${(editedAfterDone.before ?? []).map(v => String(v ?? "") || "—").join(" · ")} → ${(editedAfterDone.after ?? []).map(v => String(v ?? "") || "—").join(" · ")}`
    : null;
  const sheetPrice = task.sheetRaw?.sheetPriceRobux ?? null;
  const showMismatch = !isClosedTask && task.sheetRaw?.priceMismatch === true && sheetPrice != null && price != null;
  const conflict = !isClosedTask ? task.sheetRaw?.conflict || null : null;

  return (
    <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e5e5ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </div>
          <div style={{ marginTop: 4, fontSize: 14, color: C.textTertiary }}>
            {sheetRowLink ? (
              <a href={sheetRowLink} target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: "none" }}>
                GP {task.gamepassId ?? "?"}{googleRow ? ` · ${googleRow}` : ""} ↗
              </a>
            ) : (
              <>GP {task.gamepassId || task.id}</>
            )}
          </div>
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ borderRadius: 7, background: C.elevated, padding: "4px 8px", color: C.textSecondary, fontSize: 14, fontWeight: 700 }}>
              {sourceLabel}
            </span>
            {task.sheetRaw?.writeBackAt && (
              <span style={{ borderRadius: 7, background: tint(C.green, 0.14), padding: "4px 8px", color: C.green, fontSize: 14, fontWeight: 700 }}>
                D/E {fmtPartnerDate(task.sheetRaw.writeBackAt)}
              </span>
            )}
            {task.sheetRaw?.closedFromSheet && (
              <span style={{ borderRadius: 7, background: tint(C.green, 0.14), padding: "4px 8px", color: C.green, fontSize: 14, fontWeight: 700 }}>
                из таблицы
              </span>
            )}
            {task.sheetRaw?.protectedRangeId != null && (
              <span style={{ borderRadius: 7, background: tint(C.green, 0.14), padding: "4px 8px", color: C.green, fontSize: 14, fontWeight: 700 }}>
                🔒 защищена
              </span>
            )}
            {task.sheetRaw?.rowDeletedFromSheet && (
              <span style={{ borderRadius: 7, background: tint(C.orange, 0.14), padding: "4px 8px", color: C.orange, fontSize: 14, fontWeight: 700 }}>
                удалена из таблицы
              </span>
            )}
            {task.sheetRaw?.rowReusedForNewOrder && (
              <span style={{ borderRadius: 7, background: tint(C.orange, 0.14), padding: "4px 8px", color: C.orange, fontSize: 14, fontWeight: 700 }}>
                строка переиспользована
              </span>
            )}
            {editedAfterDone && (
              <span style={{ borderRadius: 7, background: tint(C.orange, 0.14), padding: "4px 8px", color: C.orange, fontSize: 14, fontWeight: 700 }}>
                изменено после выкупа
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 16, color: price != null ? C.accent : C.textTertiary, fontWeight: 700, ...tabular }}>
              {price != null ? `${price.toLocaleString("ru-RU")} R$ грязных` : "—"}
          </div>
          {price != null && (
            <div style={{ marginTop: 3, fontSize: 14, color: C.textTertiary, fontWeight: 700, ...tabular }}>
              {fmtUsdt(costUsdt)} · курс {fmtRate(taskRate)}
            </div>
          )}
          <div style={{ marginTop: 4 }}>
            <span style={{ fontSize: 14, color: status.color, fontWeight: 700, background: tint(status.color, 0.14), borderRadius: 7, padding: "3px 8px" }}>
              {status.label}
            </span>
          </div>
        </div>
      </div>

      {showMismatch && (
        <div style={{ background: tint(C.orange, 0.14), borderRadius: 10, padding: "10px 12px", fontSize: 14, color: C.orange, fontWeight: 600, lineHeight: 1.35 }}>
          ⚠️ В таблице {sheetPrice!.toLocaleString("ru-RU")} R$ · у ГП {price!.toLocaleString("ru-RU")} R$
        </div>
      )}
      {conflict && (
        <div style={{ background: tint(C.orange, 0.14), borderRadius: 10, padding: "10px 12px", fontSize: 14, color: C.orange, fontWeight: 600, lineHeight: 1.35 }}>
          ⚠️ {conflict}
        </div>
      )}
      {(task.error || (task.note && !showMismatch) || task.purchaseAccountName) && (
        <div style={{ fontSize: 14, color: task.error ? C.red : C.textTertiary, lineHeight: 1.35 }}>
          {task.error || (!showMismatch && task.note) || `Аккаунт: ${task.purchaseAccountName}`}
        </div>
      )}
      {writeBackError && (
        <div style={{ fontSize: 14, color: C.orange, lineHeight: 1.35 }}>
          Google write-back: {writeBackError}
        </div>
      )}
      {task.sheetRaw?.protectError && (
        <div style={{ fontSize: 14, color: C.orange, lineHeight: 1.35 }}>
          Защита строки: {task.sheetRaw.protectError}
        </div>
      )}
      {editedDiff && (
        <div style={{ fontSize: 14, color: C.textTertiary, lineHeight: 1.35 }}>
          Было → стало: {editedDiff}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, color: C.textTertiary }}>
        <span>{fmtPartnerDate(task.createdAt)}</span>
        {task.completedAt && <span>Готово {fmtPartnerDate(task.completedAt)}</span>}
      </div>

      {canClose && (
        <div style={{ display: "flex", gap: 8 }}>
          <PartnerActionButton label="Купить" color={C.accent} disabled={busy || !canPurchase} onClick={() => onPurchase(task)} />
          <PartnerActionButton label="Готово" color={C.green} disabled={busy} onClick={() => onMarkDone(task)} />
          <PartnerActionButton label="Отмена" color={C.red} disabled={busy} onClick={() => onCancel(task)} />
        </div>
      )}
    </div>
  );
}

function PartnerMismatchConfirm({ task, rate, rateBasis, robloxFeePct, busy, onConfirm, onCancel }: {
  task: PartnerTask;
  rate: number;
  rateBasis: PartnerRateBasisValue;
  robloxFeePct: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const gpPrice = task.priceRobux ?? task.purchasePriceRobux ?? 0;
  const sheetPrice = task.sheetRaw?.sheetPriceRobux ?? null;
  const costUsdt = partnerTaskCostUsdt(gpPrice, partnerTaskRate(task, rate), rateBasis, robloxFeePct);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div style={{ background: C.card, borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>Цена расходится</div>
        </div>
        <div style={{ background: C.elevated, borderRadius: 12, padding: "14px 16px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>В таблице</span><span style={{ fontWeight: 700, color: "#e5e5ea" }}>{sheetPrice != null ? `${sheetPrice.toLocaleString("ru-RU")} R$` : "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>У геймпасса</span><span style={{ fontWeight: 700, color: "#e5e5ea" }}>{gpPrice.toLocaleString("ru-RU")} R$</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>Спишется</span><span style={{ fontWeight: 700, color: C.orange }}>{fmtUsdt(costUsdt)}</span>
          </div>
        </div>
        <div style={{ background: `${C.orange}18`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: C.orange, lineHeight: 1.35 }}>
          Списание USDT идёт по фактической цене геймпасса, а не по номиналу из таблицы.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="twa-press" onClick={onCancel} disabled={busy}
            style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Отмена
          </button>
          <button className="twa-press" onClick={onConfirm} disabled={busy}
            style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Покупаю…" : "Купить"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PartnerBatchItem {
  taskId: string;
  gamepassId: string | null;
  nick: string | null;
  robux: number;
  usdt: number;
  ok: boolean;
  reason?: string;
}

function buildPartnerBuyoutPlan(
  tasks: PartnerTask[],
  balanceUsdt: number,
  rateUsdtPer1000: number,
  rateBasis: PartnerRateBasisValue,
  robloxFeePct: number,
) {
  const ready = tasks
    .filter(t => t.status === "READY")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let usdt = 0;
  const selected: PartnerTask[] = [];
  const waiting: PartnerTask[] = [];
  for (const t of ready) {
    const price = t.priceRobux ?? t.purchasePriceRobux ?? 0;
    const cost = partnerTaskCostUsdt(price, partnerTaskRate(t, rateUsdtPer1000), rateBasis, robloxFeePct);
    if (usdt + cost <= balanceUsdt) {
      selected.push(t);
      usdt += cost;
    } else {
      waiting.push(t);
    }
  }
  const totalRobux = selected.reduce((s, t) => s + (t.priceRobux ?? t.purchasePriceRobux ?? 0), 0);
  return { selected, waiting, totalRobux, totalUsdt: usdt };
}

function PartnerBatchReport({ report, onClose }: {
  report: { items: PartnerBatchItem[]; totalRobux: number; totalUsdt: number; ok: number; fail: number };
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.card, borderRadius: 18, width: "100%", maxWidth: 380, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "18px 20px 12px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea", marginBottom: 8 }}>Отчёт выкупа Антона</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.green, background: `${C.green}1c`, padding: "4px 10px", borderRadius: 999 }}>✅ {report.ok}</span>
            {report.fail > 0 && <span style={{ fontSize: 14, fontWeight: 600, color: C.red, background: `${C.red}1c`, padding: "4px 10px", borderRadius: 999 }}>❌ {report.fail}</span>}
            <span style={{ fontSize: 14, fontWeight: 600, color: C.accent, background: `${C.accent}1c`, padding: "4px 10px", borderRadius: 999, ...tabular }}>
              {report.totalRobux.toLocaleString("ru-RU")} R$ грязных ≈ {fmtUsdt(report.totalUsdt)} списано
            </span>
          </div>
        </div>
        <div style={{ height: 1, background: C.border }} />
        <div style={{ overflowY: "auto", padding: "8px 0" }}>
          {report.items.map((it, i) => (
            <div key={it.taskId + i} style={{ padding: "8px 20px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{it.ok ? "✅" : "❌"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: "#e5e5ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.nick || `GP ${it.gamepassId}`}</div>
                <div style={{ fontSize: 14, color: C.textTertiary }}>{it.robux.toLocaleString("ru-RU")} R${!it.ok && it.reason ? ` · ${it.reason}` : ""}</div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: it.ok ? C.green : C.textTertiary, flexShrink: 0, ...tabular }}>
                {it.ok ? fmtUsdt(it.usdt) : "—"}
              </span>
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: C.border }} />
        <div style={{ padding: "12px 20px" }}>
          <button className="twa-press" onClick={onClose}
            style={{ width: "100%", padding: "13px", border: "none", borderRadius: 12, background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtRate(rate: number) {
  return rate.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** Стат-плитка дашборда: label обычным текстом, значение — крупно (5.9 B3). */
/** Ф2: общая стат-плитка «Свои» и «Антона» (бывш. PartnerStatTile).
 *  onClick делает плитку кнопкой (виджеты дашборда «Свои» ведут к секциям). */
function StatTile({ label, value, sub, valueColor, subColor, onClick }: {
  label: string;
  value: string;
  sub?: string | null;
  valueColor?: string;
  subColor?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div style={{ fontSize: 14, color: C.textSecondary }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 17, fontWeight: 700, color: valueColor ?? C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 1, fontSize: 14, color: subColor ?? C.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </>
  );
  const boxStyle: React.CSSProperties = { position: "relative", background: C.bgElevated, borderRadius: 12, padding: onClick ? "10px 30px 10px 12px" : "10px 12px", minWidth: 0, minHeight: 44 };
  if (!onClick) return <div style={boxStyle}>{inner}</div>;
  return (
    <button
      className="twa-press-sm"
      onClick={() => { haptic.impact("light"); onClick(); }}
      style={{ ...boxStyle, border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", display: "block", width: "100%" }}
    >
      {inner}
      <span aria-hidden="true" style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", color: C.textTertiary, fontSize: 18 }}>›</span>
    </button>
  );
}

function PartnerSubScreenPanel({ title, summary, onClose, children }: {
  title: string;
  summary?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const backButton = window.Telegram?.WebApp?.BackButton as undefined | {
      show: () => void;
      hide: () => void;
      onClick: (callback: () => void) => void;
      offClick: (callback: () => void) => void;
    };
    backButton?.show();
    backButton?.onClick(onClose);
    return () => {
      document.body.style.overflow = previousOverflow;
      backButton?.offClick(onClose);
      backButton?.hide();
    };
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: C.bg, overflowY: "auto", WebkitOverflowScrolling: "touch", animation: "partner-slide-in .24s ease-out" }}>
      <style>{`@keyframes partner-slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
      <header style={{ position: "sticky", top: 0, zIndex: 2, background: `${C.bg}f2`, backdropFilter: "blur(18px)", borderBottom: `1px solid ${C.border}`, padding: "8px 12px 10px" }}>
        <button className="twa-press" onClick={onClose}
          style={{ minHeight: 44, border: "none", background: "none", color: C.accent, fontSize: 15, fontWeight: 700, padding: "0 8px", cursor: "pointer", fontFamily: "inherit" }}>
          ‹ Назад
        </button>
        <div style={{ padding: "0 8px 4px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.textPrimary }}>{title}</div>
          {summary && <div style={{ marginTop: 3, fontSize: 14, color: C.textSecondary }}>{summary}</div>}
        </div>
      </header>
      <div style={{ padding: "14px 16px calc(96px + env(safe-area-inset-bottom))" }}>{children}</div>
    </div>
  );
}

/** Оверлей-модалка в стиле confirm-диалогов экрана (тап по фону закрывает). */
function PartnerSheet({ title, icon, busy, onClose, children }: {
  title: string;
  icon: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ background: C.card, borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 340, maxHeight: "80vh", overflowY: "auto", boxShadow: SHADOW.pop }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>{title}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

const sheetInputStyle: React.CSSProperties = {
  width: "100%", background: C.elevated, border: "none", borderRadius: 10, color: "#fff",
  fontSize: 16, padding: "12px 14px", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

const sheetPrimaryBtn = (enabled: boolean, color: string): React.CSSProperties => ({
  flex: 1, padding: "13px 0", border: "none", borderRadius: 12,
  background: enabled ? color : C.elevated, color: "#fff", fontSize: 15, fontWeight: 700,
  cursor: enabled ? "pointer" : "default", fontFamily: "inherit", opacity: enabled ? 1 : 0.55,
});

const sheetSecondaryBtn: React.CSSProperties = {
  flex: 1, padding: "13px 0", border: "none", borderRadius: 12,
  background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};

/** 5.9 B1: пополнение из hero-кнопки — ввод + confirm в одной модалке (О3). */
function PartnerTopupSheet({ busy, onSubmit, onClose }: {
  busy: boolean;
  onSubmit: (amount: number, comment: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [confirming, setConfirming] = useState(false);
  const parsed = Number(amount.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0;

  if (confirming) {
    return (
      <PartnerSheet title="Пополнить баланс?" icon="💰" busy={busy} onClose={onClose}>
        <div style={{ background: C.elevated, borderRadius: 12, padding: "14px 16px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>Сумма</span>
            <span style={{ fontWeight: 700, color: C.green, ...tabular }}>+{fmtUsdt(parsed)}</span>
          </div>
          {comment.trim() && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15, color: C.textSecondary }}>
              <span>Комментарий</span>
              <span style={{ fontWeight: 600, color: C.textPrimary, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{comment.trim()}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="twa-press" onClick={() => setConfirming(false)} disabled={busy} style={sheetSecondaryBtn}>
            Назад
          </button>
          <button className="twa-press" disabled={busy}
            onClick={async () => {
              haptic.impact("medium");
              const ok = await onSubmit(parsed, comment.trim() || null);
              if (ok) onClose();
            }}
            style={sheetPrimaryBtn(!busy, C.green)}>
            {busy ? "Пополняю…" : "Подтвердить"}
          </button>
        </div>
      </PartnerSheet>
    );
  }

  return (
    <PartnerSheet title="Пополнение" icon="💰" busy={busy} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Сумма USDT…" autoFocus style={sheetInputStyle} />
        <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Комментарий…" style={{ ...sheetInputStyle, fontSize: 15 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <button className="twa-press" onClick={onClose} disabled={busy} style={sheetSecondaryBtn}>
            Отмена
          </button>
          <button className="twa-press" disabled={!valid || busy}
            onClick={() => { haptic.impact("light"); setConfirming(true); }}
            style={sheetPrimaryBtn(valid && !busy, C.green)}>
            Пополнить
          </button>
        </div>
      </div>
    </PartnerSheet>
  );
}

/** 5.9 B2 + A4: смена курса с confirm «старый → новый», история смен и отчёт по курсам (О1). */
function PartnerRateSheet({ busy, currentRate, purchaseRate, rateBasis, robloxFeePct, rateChanges, rateReport, onSubmit, onClose }: {
  busy: boolean;
  currentRate: number;
  purchaseRate: number;
  rateBasis: PartnerRateBasisValue;
  robloxFeePct: number;
  rateChanges: PartnerRateChangeEntry[];
  rateReport: PartnerRateReportRow[];
  onSubmit: (rate: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [rateInput, setRateInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const parsed = Number(rateInput.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= 1000;

  if (confirming) {
    return (
      <PartnerSheet title="Сменить курс?" icon="💱" busy={busy} onClose={onClose}>
        <div style={{ background: C.elevated, borderRadius: 12, padding: "16px", marginBottom: 12, textAlign: "center" }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: C.textSecondary, ...tabular }}>{fmtRate(currentRate)}</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: C.textTertiary }}> → </span>
          <span style={{ fontSize: 20, fontWeight: 700, color: C.accent, ...tabular }}>{fmtRate(parsed)}</span>
          <div style={{ marginTop: 4, fontSize: 14, color: C.textSecondary }}>USDT / 1000 R$ из таблицы</div>
        </div>
        <div style={{ background: tint(C.orange, 0.12), borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: C.orange, lineHeight: 1.35 }}>
          Применится только к будущим выкупам. Уже выкупленные заказы зафиксированы по курсу на момент выкупа.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="twa-press" onClick={() => setConfirming(false)} disabled={busy} style={sheetSecondaryBtn}>
            Назад
          </button>
          <button className="twa-press" disabled={busy}
            onClick={async () => {
              haptic.impact("medium");
              const ok = await onSubmit(parsed);
              if (ok) onClose();
            }}
            style={sheetPrimaryBtn(!busy, C.accent)}>
            {busy ? "Сохраняю…" : "Подтвердить"}
          </button>
        </div>
      </PartnerSheet>
    );
  }

  return (
    <PartnerSheet title="Курс" icon="💱" busy={busy} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
          <span>Текущий</span>
          <span style={{ fontWeight: 700, color: C.textPrimary, ...tabular }}>{fmtRate(currentRate)} USDT / 1000 {rateBasis === "NET" ? "чистых" : "грязных"} R$</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
          <span>Закупка</span>
          <span style={{ fontWeight: 700, color: C.textPrimary, ...tabular }}>{fmtRate(purchaseRate)} USDT / 1000 грязных R$</span>
        </div>
        <div style={{ fontSize: 13, color: C.textTertiary, lineHeight: 1.4 }}>
          Комиссия Roblox {fmtRate(robloxFeePct)}% оплачивается нами. В TWA меняется только ставка Антона; полная политика редактируется в веб-админке.
        </div>
        <input value={rateInput} onChange={e => setRateInput(e.target.value)} inputMode="decimal"
          placeholder={`Новый курс за 1000 ${rateBasis === "NET" ? "чистых" : "грязных"} R$…`} autoFocus style={sheetInputStyle} />
        <div style={{ display: "flex", gap: 10 }}>
          <button className="twa-press" onClick={onClose} disabled={busy} style={sheetSecondaryBtn}>
            Закрыть
          </button>
          <button className="twa-press" disabled={!valid || busy}
            onClick={() => { haptic.impact("light"); setConfirming(true); }}
            style={sheetPrimaryBtn(valid && !busy, C.accent)}>
            Сменить
          </button>
        </div>

        {rateReport.length > 0 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textSecondary, margin: "10px 0 6px" }}>
              Выкуплено по курсам
            </div>
            <div style={{ background: C.elevated, borderRadius: 12, overflow: "hidden" }}>
              {rateReport.map((row, i) => (
                <div key={`${row.rate ?? "unknown"}:${row.purchaseRate ?? "unknown"}:${row.rateBasis ?? "unknown"}`} style={{ padding: "10px 12px", borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 15 }}>
                    <span style={{ fontWeight: 700, color: row.rate === null ? C.textTertiary : C.textPrimary, ...tabular }}>
                      {row.rate === null ? "курс не записан" : `${fmtRate(row.rate)} ${row.rateBasis === "NET" ? "net" : "gross"}`}
                    </span>
                    <span style={{ color: C.textSecondary, ...tabular }}>{row.buyouts} шт · {row.totalRobux.toLocaleString("ru-RU")} грязных R$</span>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 14, color: C.textTertiary, textAlign: "right", ...tabular }}>
                    выручка {fmtUsdt(row.revenueUsdt)} · прибыль {row.profitUsdt == null ? "—" : fmtUsdt(row.profitUsdt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {rateChanges.length > 0 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textSecondary, margin: "10px 0 6px" }}>
              История курса
            </div>
            <div style={{ background: C.elevated, borderRadius: 12, overflow: "hidden" }}>
              {rateChanges.map((change, i) => (
                <div key={change.id} style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 10, borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, ...tabular }}>
                    {change.previousRate !== null ? `${fmtRate(change.previousRate)} → ` : ""}{fmtRate(change.rate)}
                  </span>
                  <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>{fmtPartnerDate(change.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PartnerSheet>
  );
}

function PartnerAntonSection({ token, accountName }: { token: string; accountName: string | null }) {
  const [state, setState] = useState<PartnerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gamepassInput, setGamepassInput] = useState("");
  const [nickInput, setNickInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  // 5.9 B1/B2: пополнение и курс живут в модалках дашборда, не в секциях.
  const [showTopupSheet, setShowTopupSheet] = useState(false);
  const [showRateSheet, setShowRateSheet] = useState(false);
  const [importResult, setImportResult] = useState<PartnerImportResult | null>(null);
  const [googleSyncResult, setGoogleSyncResult] = useState<GoogleSyncResult | null>(null);
  const [taskFilter, setTaskFilter] = useState<"all" | "errors" | "mismatch">("all");
  const [confirmMismatchTask, setConfirmMismatchTask] = useState<PartnerTask | null>(null);
  // 5.7 E1: отмена ошибочного пополнения — только через confirm-диалог.
  const [confirmCancelTopup, setConfirmCancelTopup] = useState<PartnerLedgerEntry | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [subScreen, setSubScreen] = useState<PartnerSubScreenKey | null>(null);
  const [subScreenItems, setSubScreenItems] = useState<Array<PartnerTask | PartnerLedgerEntry>>([]);
  const [subScreenCursor, setSubScreenCursor] = useState<string | null>(null);
  const [subScreenLoading, setSubScreenLoading] = useState(false);
  const [subTaskFilter, setSubTaskFilter] = useState<"all" | "ready" | "failed" | "done" | "cancelled">("all");
  const [ledgerFilter, setLedgerFilter] = useState<"all" | "topup" | "buyout">("all");
  const [expandedLedgerGroup, setExpandedLedgerGroup] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; current?: string } | null>(null);
  const bulkStopRef = useRef(false);
  const [bulkReport, setBulkReport] = useState<{ items: PartnerBatchItem[]; totalRobux: number; totalUsdt: number; ok: number; fail: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkDoneRunning, setBulkDoneRunning] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const applyPartnerState = (payload: Record<string, unknown>) => {
    if (payload.partner && Array.isArray(payload.tasks) && Array.isArray(payload.ledgerEntries) && payload.summary) {
      setState(payload as unknown as PartnerState);
      if (payload.syncResult) setGoogleSyncResult(payload.syncResult as GoogleSyncResult);
      setLoadError(null);
    }
  };

  // П1: silent-refresh — фоновый GET не показывает скелетон, не сбрасывает формы
  // и молчит при ошибках (сеть моргнула — экран не трогаем, следующий тик доедет).
  const loadInFlightRef = useRef(false);
  const busyRef = useRef(false);
  // GET не ждёт Google sync (сервер уводит его в after): если sync запланирован,
  // через ~12 с тихо перечитываем состояние, чтобы подтянуть его результат.
  const syncFollowUpRef = useRef<number | null>(null);
  const loadRef = useRef<((opts?: { background?: boolean }) => Promise<void>) | null>(null);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => () => {
    if (syncFollowUpRef.current) window.clearTimeout(syncFollowUpRef.current);
  }, []);

  const load = useCallback(async (opts: { background?: boolean } = {}) => {
    const background = opts.background === true;
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!background) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const r = await fetch("/api/twa/partners/anton/tasks", { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) {
        if (background) return;
        const message = d?.error ?? "Ошибка загрузки Антона";
        setLoadError(message);
        haptic.notify("error");
        toast(message, "error");
        return;
      }
      applyPartnerState(d);
      if (d.syncScheduled === true) {
        if (syncFollowUpRef.current) window.clearTimeout(syncFollowUpRef.current);
        syncFollowUpRef.current = window.setTimeout(() => {
          syncFollowUpRef.current = null;
          // Во время батча/операции follow-up пропускаем (№4) — штатный тик доедет.
          if (busyRef.current) return;
          void loadRef.current?.({ background: true });
        }, 12_000);
      }
    } catch {
      if (!background) {
        setLoadError("Ошибка сети");
        haptic.notify("error");
        toast("Ошибка сети", "error");
      }
    } finally {
      loadInFlightRef.current = false;
      if (!background) setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  // Пока открыт workspace «Антон» и вкладка видима, раз в ~75 с подтягиваем свежие
  // задачи (сервер сам делает opportunistic Google sync на GET с TTL 60 с). Возврат
  // в TWA — немедленный тик; переключение workspace монтирует секцию заново (mount-load).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      void load({ background: true });
    };
    const interval = window.setInterval(tick, 75_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const loadSubScreenPage = useCallback(async (screen: PartnerSubScreenKey, cursor: string | null, append: boolean) => {
    setSubScreenLoading(true);
    try {
      const view = screen === "bought" ? "history" : screen;
      const params = new URLSearchParams({ view });
      if (cursor) params.set("cursor", cursor);
      const r = await fetch(`/api/twa/partners/anton/tasks?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await r.json().catch(() => null);
      if (!r.ok || !payload || !Array.isArray(payload.items)) {
        toast(payload?.error ?? "Не удалось загрузить детализацию", "error");
        return;
      }
      setSubScreenItems((previous) => append ? [...previous, ...payload.items] : payload.items);
      setSubScreenCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
    } catch {
      toast("Ошибка сети при загрузке детализации", "error");
    } finally {
      setSubScreenLoading(false);
    }
  }, [token]);

  const openSubScreen = useCallback((screen: PartnerSubScreenKey) => {
    haptic.select();
    setSubScreen(screen);
    setSubScreenItems([]);
    setSubScreenCursor(null);
    setSubTaskFilter("all");
    setLedgerFilter("all");
    setExpandedLedgerGroup(null);
    void loadSubScreenPage(screen, null, false);
  }, [loadSubScreenPage]);

  const closeSubScreen = useCallback(() => setSubScreen(null), []);

  async function post(action: string, body: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true);
    try {
      const r = await fetch("/api/twa/partners/anton/tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({ action, ...body }),
      });
      const d = await r.json().catch(() => null);
      if (d) applyPartnerState(d);
      if (!r.ok || !d || d.ok === false || d.success === false) {
        haptic.notify("error");
        toast(d?.error ?? d?.msg ?? "Ошибка", "error");
        return false;
      }
      haptic.notify("success");
      return true;
    } catch {
      haptic.notify("error");
      toast("Ошибка сети", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function importXlsx(file: File | null) {
    if (!file || busy) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("action", "import-xlsx");
      formData.append("file", file);
      const r = await fetch("/api/twa/partners/anton/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const d = await r.json().catch(() => null);
      if (d) applyPartnerState(d);
      if (!r.ok || !d || d.ok === false || d.success === false) {
        haptic.notify("error");
        toast(d?.error ?? d?.msg ?? "Ошибка XLSX", "error");
        return;
      }
      const result = d.importResult as PartnerImportResult | undefined;
      setImportResult(result ?? null);
      haptic.notify("success");
      toast(result ? `XLSX: +${result.created}, пропущено ${result.skipped}, ошибок ${result.failed}` : "XLSX загружен", "success");
    } catch {
      haptic.notify("error");
      toast("Ошибка загрузки XLSX", "error");
    } finally {
      setBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function syncGoogleSheets() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/twa/partners/anton/tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "sync-google-sheets" }),
      });
      const d = await r.json().catch(() => null);
      if (d) applyPartnerState(d);
      const result = d?.syncResult as GoogleSyncResult | undefined;
      setGoogleSyncResult(result ?? null);
      if (!r.ok || !d || d.ok === false || d.success === false || result?.status === "failed") {
        haptic.notify("error");
        toast(d?.error ?? result?.error ?? result?.message ?? "Ошибка Google Sheets", "error");
        return;
      }
      haptic.notify(result?.status === "partial" ? "warning" : "success");
      toast(result
        ? `Google: прочитано ${result.diagnostics?.readRows ?? 0}, фильтр ${result.diagnostics?.matchedRows ?? result.rowCount ?? 0}, ошибок ${result.failed ?? 0}`
        : "Google Sheets обновлены",
        result?.status === "partial" ? "default" : "success");
    } catch {
      haptic.notify("error");
      toast("Ошибка Google Sheets", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createTask() {
    const gamepass = gamepassInput.trim();
    if (!gamepass) return;
    const ok = await post("create-task", {
      gamepass,
      robloxUsername: nickInput.trim() || null,
      note: noteInput.trim() || null,
    });
    if (ok) {
      setGamepassInput("");
      setNickInput("");
      setNoteInput("");
      toast("Задача создана", "success");
    }
  }

  async function topup(amount: number, comment: string | null) {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const ok = await post("ledger-topup", { amount, comment });
    if (ok) toast("Баланс Антона пополнен", "success");
    return ok;
  }

  async function saveRate(rate: number) {
    if (!Number.isFinite(rate) || rate <= 0) return false;
    const ok = await post("set-rate", { robuxRateUsdtPer1000: rate });
    if (ok) toast("Курс Антона обновлён", "success");
    return ok;
  }

  // Увед в админку о выкупе (владелец: обязательно). Fire-and-forget — деньги
  // уже списаны и state перечитан, доставка карточки не должна держать UI.
  // Суммы сервер берёт из БД по id, здесь передаём только список выкупленных задач.
  function notifyBuyout(taskIds: string[], failCount = 0) {
    if (taskIds.length === 0) return;
    void fetch("/api/twa/partners/anton/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "notify-buyout", taskIds, failCount }),
    }).catch(() => {});
  }

  async function doPartnerBulk(queue: PartnerTask[]) {
    if (bulkRunning || busy || queue.length === 0) return;
    setBulkRunning(true);
    // №4 ультра-ревью: на время батча блокируем карточки/формы (busy) и 75-с тик
    // (busyRef) — иначе оператор ловит 409-тосты, а фоновые GET+sync идут параллельно.
    setBusy(true);
    bulkStopRef.current = false;
    setBulkProgress({ done: 0, total: queue.length });
    const items: PartnerBatchItem[] = [];
    let ok = 0;
    const purchaseBatchId = globalThis.crypto.randomUUID();
    const rateVal = summary?.robuxRateUsdtPer1000 ?? state?.partner.robuxRateUsdtPer1000 ?? 5.3;
    const basisVal: PartnerRateBasisValue = "DIRTY";
    const feeVal = summary?.robloxFeePct ?? state?.partner.robloxFeePct ?? 30;
    try {
      for (let i = 0; i < queue.length; i++) {
        if (bulkStopRef.current) break;
        const t = queue[i];
        const price = t.priceRobux ?? t.purchasePriceRobux ?? 0;
        const usdt = partnerTaskCostUsdt(price, partnerTaskRate(t, rateVal), basisVal, feeVal);
        if (i > 0) await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 6000)));
        if (bulkStopRef.current) break;
        setBulkProgress({ done: i, total: queue.length, current: t.robloxUsername || `GP ${t.gamepassId}` });
        try {
          const r = await fetch("/api/twa/partners/anton/tasks", {
            method: "POST",
            headers,
            body: JSON.stringify({ action: "purchase-task", taskId: t.id, purchaseBatchId }),
          });
          const d = await r.json().catch(() => null);
          if (d) applyPartnerState(d);
          if (r.ok && d && d.ok !== false && d.success !== false) {
            ok++;
            items.push({ taskId: t.id, gamepassId: t.gamepassId, nick: t.robloxUsername, robux: price, usdt, ok: true });
            haptic.impact("light");
          } else {
            const reason = d?.error ?? d?.msg ?? `HTTP ${r.status}`;
            items.push({ taskId: t.id, gamepassId: t.gamepassId, nick: t.robloxUsername, robux: price, usdt, ok: false, reason });
            if (shouldStopBatch(reason)) { bulkStopRef.current = true; }
          }
        } catch {
          items.push({ taskId: t.id, gamepassId: t.gamepassId, nick: t.robloxUsername, robux: price, usdt, ok: false, reason: "ошибка сети" });
        }
        setBulkProgress({ done: i + 1, total: queue.length });
      }
    } finally {
      setBusy(false);
    }
    const fail = items.length - ok;
    const totalRobux = items.filter(x => x.ok).reduce((s, x) => s + x.robux, 0);
    const totalUsdt = items.filter(x => x.ok).reduce((s, x) => s + x.usdt, 0);
    setBulkRunning(false);
    setBulkProgress(null);
    setBulkReport({ items, totalRobux, totalUsdt, ok, fail });
    haptic.notify(fail === 0 ? "success" : "warning");
    notifyBuyout(items.filter(x => x.ok).map(x => x.taskId), fail);
    void load({ background: true });
  }

  async function doPartnerBulkMarkDone(taskIds: string[]) {
    if (busy || bulkDoneRunning || taskIds.length === 0) return;
    setBulkDoneRunning(true);
    setBusy(true);
    try {
      const r = await fetch("/api/twa/partners/anton/tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "mark-done-bulk", taskIds, purchaseAccountName: accountName || null }),
      });
      const d = await r.json().catch(() => null);
      if (d) applyPartnerState(d);
      if (!r.ok || !d || d.ok === false) {
        haptic.notify("error");
        toast(d?.error ?? "Ошибка", "error");
        return;
      }
      const report = d.bulkDoneReport;
      if (report) {
        const rateVal = summary?.robuxRateUsdtPer1000 ?? state?.partner.robuxRateUsdtPer1000 ?? 5.3;
        const basisVal: PartnerRateBasisValue = "DIRTY";
        const feeVal = summary?.robloxFeePct ?? state?.partner.robloxFeePct ?? 30;
        const items: PartnerBatchItem[] = report.results.map((r: any) => {
          const task = (state?.tasks ?? []).find(t => t.id === r.taskId);
          const robux = task ? (task.priceRobux ?? task.purchasePriceRobux ?? 0) : 0;
          return {
            taskId: r.taskId,
            gamepassId: task?.gamepassId ?? null,
            nick: task?.robloxUsername ?? null,
            robux,
            usdt: partnerTaskCostUsdt(robux, task ? partnerTaskRate(task, rateVal) : rateVal, basisVal, feeVal),
            ok: r.ok,
            reason: r.reason,
          };
        });
        setBulkReport({ items, totalRobux: report.totalRobux, totalUsdt: report.totalUsdt, ok: report.ok, fail: report.fail });
        notifyBuyout(items.filter(x => x.ok).map(x => x.taskId), report.fail);
      }
      haptic.notify("success");
      setSelectMode(false);
      setSelectedTaskIds(new Set());
    } catch {
      haptic.notify("error");
      toast("Ошибка сети", "error");
    } finally {
      setBulkDoneRunning(false);
      setBusy(false);
    }
  }

  const tasks = state?.tasks ?? [];
  const ledger = state?.ledgerEntries ?? [];
  const summary = state?.summary;
  const rate = summary?.robuxRateUsdtPer1000 ?? state?.partner.robuxRateUsdtPer1000 ?? 5.3;
  const purchaseRate = summary?.purchaseRateUsdtPer1000 ?? state?.partner.purchaseRateUsdtPer1000 ?? 4.7;
  const rateBasis: PartnerRateBasisValue = "DIRTY";
  const robloxFeePct = summary?.robloxFeePct ?? state?.partner.robloxFeePct ?? 30;
  const rateReport = state?.rateReport ?? [];
  const rateChanges = state?.rateChanges ?? [];
  const errorCount = summary?.failed ?? 0;
  const mismatchCount = summary?.mismatches ?? 0;
  const conflictCount = summary?.conflicts ?? 0;

  // №3 ультра-ревью: silent-refresh может обнулить счётчик при активном фильтре —
  // чипы исчезают, фильтр остаётся («Нет активных задач» без способа сброса).
  // Не синхронизируем состояние, а выводим: при нулевом счётчике фильтр = «Все».
  const effectiveTaskFilter = (taskFilter === "errors" && errorCount === 0)
    || (taskFilter === "mismatch" && mismatchCount === 0)
    ? "all"
    : taskFilter;

  const isMismatchTask = (t: PartnerTask) =>
    t.sheetRaw?.priceMismatch === true && t.status !== "DONE" && t.status !== "CANCELLED";
  const filteredTasks = effectiveTaskFilter === "errors"
    ? tasks.filter(t => t.status === "FAILED")
    : effectiveTaskFilter === "mismatch"
      ? tasks.filter(isMismatchTask)
      : tasks;
  const HISTORY_STATUSES = new Set(["DONE", "CANCELLED"]);
  // Задачи с ошибкой в таблице (FAILED — вкл. расхождение цены) уходят ВНИЗ активного
  // списка, чтобы рабочие READY-задачи были сверху (запрос владельца). .filter() отдаёт
  // новый массив, поэтому .sort() не мутирует state; сорт стабилен → внутри групп
  // сохраняется серверный порядок updatedAt desc.
  const activeTasks = filteredTasks
    .filter(t => !HISTORY_STATUSES.has(t.status))
    .sort((a, b) => (a.status === "FAILED" ? 1 : 0) - (b.status === "FAILED" ? 1 : 0));
  const purchaseTask = (t: PartnerTask) => {
    // Расхождение «номинал таблицы vs live-цена ГП» — покупка только через confirm.
    if (isMismatchTask(t)) {
      haptic.impact("medium");
      setConfirmMismatchTask(t);
      return;
    }
    haptic.impact("medium");
    void (async () => {
      if (await post("purchase-task", { taskId: t.id })) notifyBuyout([t.id]);
    })();
  };
  // 5.9 B4: тап по чипу проблем в дашборде = фильтр списка задач + скролл к нему.
  const tasksSectionRef = useRef<HTMLElement | null>(null);
  const jumpToTasks = (filter: "errors" | "mismatch" | null) => {
    haptic.select();
    if (filter) setTaskFilter(filter);
    tasksSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const sheetConnected = !!state?.partner.googleSheetId || !!state?.partner.googleSheetUrl;
  const googleSync = state?.googleSync;
  const latestRun = googleSync?.latestRun ?? null;
  const latestSyncResult = googleSyncResult ?? null;
  const latestRecon = (latestSyncResult?.diagnostics ?? latestRun?.diagnostics)?.reconciliation ?? null;
  // 5.8: итоги установки защит строк (addProtectedRange) последнего прогона.
  const latestProtection = (latestSyncResult?.diagnostics ?? latestRun?.diagnostics)?.protection ?? null;
  const googleSheetUrl = state?.partner.googleSheetUrl
    ?? (state?.partner.googleSheetId ? `https://docs.google.com/spreadsheets/d/${state.partner.googleSheetId}/edit` : null);
  const googleStatus = !sheetConnected
    ? "Нужен sheetId"
    : googleSync?.serviceAccountConfigured === false
      ? "Нет service account"
      : "Подключена";
  const canSyncGoogle = sheetConnected && googleSync?.serviceAccountConfigured !== false;

  if (loading) {
    return (
      <section>
        <SectionHeader title="Антон" />
        <Card>
          <div style={{ padding: "18px 16px", color: C.textSecondary, fontSize: 15 }}>Загружаю…</div>
        </Card>
      </section>
    );
  }

  if (loadError && !state) {
    return (
      <section>
        <SectionHeader title="Антон" />
        <Card>
          <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ color: C.red, fontSize: 15, fontWeight: 700 }}>{loadError}</div>
            <div style={{ color: C.textSecondary, fontSize: 13, lineHeight: 1.35 }}>
              Данные Антона не загружены, операции временно недоступны.
            </div>
            <button className="twa-press" onClick={() => { haptic.impact("medium"); void load(); }} disabled={loading}
              style={{ width: "100%", background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 700, padding: "13px", cursor: "pointer", opacity: loading ? 0.55 : 1 }}>
              Повторить
            </button>
          </div>
        </Card>
      </section>
    );
  }

  return (
    <>
      <section>
        <SectionHeader title="Антон" hint={fmtSyncAgo(googleSync?.lastSyncAt ?? null)} />
        <Card>
          {/* 5.9 B1: hero-баланс + «Пополнить». Пропорциональные цифры: tabular на
              крупном одиночном числе разряжает «0» и выглядит рыхло. */}
          <div style={{ padding: "16px 16px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <button className="twa-press" onClick={() => openSubScreen("ledger")}
              style={{ position: "relative", minWidth: 0, minHeight: 44, flex: 1, border: "none", background: "none", padding: "0 24px 0 0", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>Баланс</div>
              <div style={{ marginTop: 3, fontSize: 34, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.15, color: (summary?.balanceUsdt ?? 0) < 0 ? C.red : C.textPrimary }}>
                {(summary?.balanceUsdt ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span style={{ fontSize: 17, fontWeight: 600, color: C.textSecondary, marginLeft: 6 }}>USDT</span>
              </div>
              <span aria-hidden="true" style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", color: C.textTertiary, fontSize: 22 }}>›</span>
            </button>
            <button className="twa-press" disabled={busy}
              onClick={() => { haptic.impact("medium"); setShowTopupSheet(true); }}
              style={{
                flexShrink: 0, minHeight: 44, padding: "0 16px", border: "none", borderRadius: 12,
                background: tint(C.green, 0.16), color: C.green, fontSize: 15, fontWeight: 700,
                cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.55 : 1,
              }}>
              Пополнить
            </button>
          </div>
          {(summary?.balanceUsdt ?? 0) < 0 && (
            <div style={{ padding: "0 16px 12px" }}>
              <div style={{ background: tint(C.red, 0.14), borderRadius: 10, padding: "10px 12px", fontSize: 14, color: C.red, fontWeight: 600, lineHeight: 1.35 }}>
                ⚠️ Баланс в минусе: ручные «готово» из таблицы списали больше, чем пополнено. Нужно пополнение.
              </div>
            </div>
          )}
          <div style={{ height: 1, background: C.border, marginLeft: 16 }} />
          {/* 5.9 B2: строка курса целиком тап-таргет — открывает модалку смены/истории. */}
          <button className="twa-press" disabled={busy}
            onClick={() => { haptic.impact("light"); setShowRateSheet(true); }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              width: "100%", minHeight: 48, padding: "12px 16px", border: "none", background: "none",
              cursor: busy ? "default" : "pointer", fontFamily: "inherit", textAlign: "left",
            }}>
            <span style={{ fontSize: 15, color: C.textSecondary }}>Курс</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, ...tabular }}>{fmtRate(rate)} / 1000 R$ из таблицы</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.accent, flexShrink: 0 }}>Изменить ›</span>
            </span>
          </button>
          <div style={{ height: 1, background: C.border, marginLeft: 16 }} />
          {/* 5.9 B3: стат-плитки. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 12 }}>
            <StatTile label="Чистых R$" value={`${(summary?.netRobux ?? 0).toLocaleString("ru-RU")} R$`} sub={`${(summary?.grossRobux ?? summary?.doneRobux ?? 0).toLocaleString("ru-RU")} грязных`} onClick={() => openSubScreen("bought")} />
            <StatTile label="Выручка" value={fmtUsdt(summary?.revenueUsdt ?? summary?.spentUsdt)} sub={summary?.profitUsdt == null ? "прибыль после бэкфилла" : `прибыль ${fmtUsdt(summary.profitUsdt)}`} onClick={() => openSubScreen("ledger")} />
            <StatTile
              label="В работе"
              value={`${(summary?.ready ?? 0) + (summary?.purchasing ?? 0)}`}
              sub={`ready ${summary?.ready ?? 0} · buying ${summary?.purchasing ?? 0}`}
              onClick={() => jumpToTasks(null)}
            />
            <StatTile
              label="Задачи"
              value={`${summary?.total ?? 0}`}
              sub={`готово ${summary?.done ?? 0}`}
              onClick={() => openSubScreen("tasks")}
            />
          </div>
          {(summary?.reservedUsdt ?? 0) > 0 && (
            <div style={{ padding: "0 16px 12px", fontSize: 14, color: C.textSecondary }}>
              Зарезервировано под выкуп ≈ {fmtUsdt(summary?.reservedUsdt)}
            </div>
          )}
          {errorCount + mismatchCount + conflictCount > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 12px 12px" }}>
              {errorCount > 0 && (
                <button className="twa-press-sm" onClick={() => jumpToTasks("errors")}
                  style={{ border: "none", borderRadius: 9, padding: "8px 12px", minHeight: 36, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: tint(C.red, 0.14), color: C.red }}>
                  ошибки {errorCount}
                </button>
              )}
              {mismatchCount > 0 && (
                <button className="twa-press-sm" onClick={() => jumpToTasks("mismatch")}
                  style={{ border: "none", borderRadius: 9, padding: "8px 12px", minHeight: 36, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: tint(C.orange, 0.14), color: C.orange }}>
                  расхожд. {mismatchCount}
                </button>
              )}
              {conflictCount > 0 && (
                <span style={{ borderRadius: 9, padding: "8px 12px", minHeight: 36, boxSizing: "border-box", fontSize: 14, fontWeight: 700, background: tint(C.orange, 0.14), color: C.orange }}>
                  конфликты {conflictCount}
                </span>
              )}
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionHeader title="Google Sheets" />
        <Card>
          <InfoRow label="Статус" value={googleStatus} />
          <InfoRow label="Последний sync" value={fmtPartnerDate(googleSync?.lastSyncAt ?? latestRun?.finishedAt ?? null)} />
          {latestRun && (
            <InfoRow
              label="Итог"
              value={`${latestRun.status === "SUCCESS" ? "" : `${latestRun.status} · `}+${latestRun.createdCount} · обновлено ${latestRun.updatedCount} · ошибок ${latestRun.failedCount}`}
            />
          )}
          {(() => {
            const parts = latestRecon
              ? [
                (latestRecon.closedFromSheet ?? 0) > 0 ? `закрыто ${latestRecon.closedFromSheet}` : null,
                (latestRecon.failedFromSheet ?? 0) > 0 ? `ошибка ${latestRecon.failedFromSheet}` : null,
                (latestRecon.cancelledFromSheet ?? 0) > 0 ? `отмена ${latestRecon.cancelledFromSheet}` : null,
                (latestRecon.deletedFromSheet ?? 0) > 0 ? `удалено ${latestRecon.deletedFromSheet}` : null,
                (latestRecon.doneMarkedDeleted ?? 0) > 0 ? `готово-удалено ${latestRecon.doneMarkedDeleted}` : null,
                (latestRecon.revived ?? 0) > 0 ? `возврат ${latestRecon.revived}` : null,
                (latestRecon.conflicts ?? 0) > 0 ? `конфликты ${latestRecon.conflicts}` : null,
                (latestRecon.importedDone ?? 0) > 0 ? `готово-импорт ${latestRecon.importedDone}` : null,
                (latestRecon.rowsReused ?? 0) > 0 ? `переиспользовано ${latestRecon.rowsReused}` : null,
                (latestRecon.reactivated ?? 0) > 0 ? `исправлено ${latestRecon.reactivated}` : null,
                (latestRecon.editedAfterDone ?? 0) > 0 ? `правка-готово ${latestRecon.editedAfterDone}` : null,
              ].filter(Boolean)
              : [];
            return parts.length > 0 ? <InfoRow label="Из таблицы" value={parts.join(" · ")} /> : null;
          })()}
          {(() => {
            const parts = latestProtection
              ? [
                (latestProtection.locked ?? 0) > 0 ? `🔒 ${latestProtection.locked}` : null,
                (latestProtection.healed ?? 0) > 0 ? `восстановлено ${latestProtection.healed}` : null,
                (latestProtection.unlocked ?? 0) > 0 ? `снято ${latestProtection.unlocked}` : null,
                (latestProtection.pendingLocked ?? 0) > 0 ? `D-лок ${latestProtection.pendingLocked}` : null,
                (latestProtection.pendingUnlocked ?? 0) > 0 ? `D-снято ${latestProtection.pendingUnlocked}` : null,
                (latestProtection.failed ?? 0) > 0 ? `не удалось ${latestProtection.failed}` : null,
              ].filter(Boolean)
              : [];
            return parts.length > 0 ? <InfoRow label="Защита строк" value={parts.join(" · ")} /> : null;
          })()}
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="twa-press" onClick={() => { haptic.impact("medium"); syncGoogleSheets(); }} disabled={busy || !canSyncGoogle}
                style={{ flex: 1, background: canSyncGoogle ? C.accent : C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 700, padding: "13px", cursor: busy || !canSyncGoogle ? "default" : "pointer", opacity: busy || !canSyncGoogle ? 0.55 : 1 }}>
                Синхронизировать
              </button>
              {googleSheetUrl && (
                <a className="twa-press" href={googleSheetUrl} target="_blank" rel="noreferrer"
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.elevated, borderRadius: 10, color: C.accent, fontSize: 15, fontWeight: 700, padding: "13px 0", textDecoration: "none" }}>
                  Таблица ↗
                </a>
              )}
            </div>
            {(latestRun?.error || latestSyncResult?.error || latestSyncResult?.message || latestSyncResult?.errors?.[0]) && (
              <div style={{ color: latestRun?.status === "FAILED" || latestSyncResult?.status === "failed" ? C.red : C.textTertiary, fontSize: 13, lineHeight: 1.35 }}>
                {latestRun?.error || latestSyncResult?.errors?.[0] || latestSyncResult?.error || latestSyncResult?.message}
              </div>
            )}
          </div>
        </Card>
      </section>

      <section ref={tasksSectionRef}>
        <SectionHeader title="Задачи" />
        {(() => {
          const plan = buildPartnerBuyoutPlan(tasks, summary?.balanceUsdt ?? 0, rate, rateBasis, robloxFeePct);
          if (plan.selected.length > 0 && !bulkRunning) return (
            <Card>
              <div style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#e5e5ea" }}>
                    Готово к выкупу: {plan.selected.length}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.accent, ...tabular }}>
                    {plan.totalRobux.toLocaleString("ru-RU")} грязных R$ ≈ {fmtUsdt(plan.totalUsdt)} списания
                  </span>
                </div>
                {plan.waiting.length > 0 && (
                  <div style={{ fontSize: 14, color: C.orange, marginBottom: 8 }}>
                    Не хватает баланса на {plan.waiting.length} задач
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="twa-press" disabled={busy}
                    onClick={() => { haptic.impact("heavy"); void doPartnerBulk(plan.selected); }}
                    style={{
                      flex: 1, padding: "13px", border: "none", borderRadius: 12,
                      background: C.green, color: "#fff", fontSize: 15, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1,
                    }}>
                    Выкупить всё ({plan.selected.length})
                  </button>
                  <button className="twa-press" disabled={busy || bulkDoneRunning}
                    onClick={() => { haptic.impact("heavy"); void doPartnerBulkMarkDone(activeTasks.filter(t => t.status !== "PURCHASING").map(t => t.id)); }}
                    style={{
                      flex: 1, padding: "13px", border: "none", borderRadius: 12,
                      background: C.accent, color: "#fff", fontSize: 15, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1,
                    }}>
                    {bulkDoneRunning ? "Отмечаю..." : `Выкуплено всё (${activeTasks.filter(t => t.status !== "PURCHASING").length})`}
                  </button>
                </div>
              </div>
            </Card>
          );
          if (bulkRunning && bulkProgress) return (
            <Card>
              <div style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#e5e5ea" }}>
                    Выкуп: {bulkProgress.done}/{bulkProgress.total}
                  </span>
                  {bulkProgress.current && (
                    <span style={{ fontSize: 14, color: C.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                      {bulkProgress.current}
                    </span>
                  )}
                </div>
                <div style={{ height: 4, borderRadius: 2, background: C.elevated, marginBottom: 10, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, background: C.green, transition: "width .3s", width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
                </div>
                <button className="twa-press"
                  onClick={() => { bulkStopRef.current = true; haptic.impact("medium"); }}
                  style={{
                    width: "100%", padding: "13px", border: "none", borderRadius: 12,
                    background: C.red, color: "#fff", fontSize: 15, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>
                  Остановить
                </button>
              </div>
            </Card>
          );
          return null;
        })()}
        {(errorCount > 0 || mismatchCount > 0) && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {([
              { id: "all" as const, label: `Все ${tasks.length}`, show: true },
              { id: "errors" as const, label: `Ошибки ${errorCount}`, show: errorCount > 0 },
              { id: "mismatch" as const, label: `Расхождения ${mismatchCount}`, show: mismatchCount > 0 },
            ]).filter(o => o.show).map(o => (
              <button
                key={o.id}
                className="twa-press-sm"
                onClick={() => { haptic.select(); setTaskFilter(effectiveTaskFilter === o.id ? "all" : o.id); }}
                style={{
                  border: "none", borderRadius: 9, padding: "8px 12px", minHeight: 36,
                  fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: effectiveTaskFilter === o.id ? (o.id === "all" ? C.accent : C.orange) : C.elevated,
                  color: effectiveTaskFilter === o.id ? "#fff" : C.textSecondary,
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {activeTasks.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8, justifyContent: "flex-end" }}>
            {!selectMode ? (
              <button className="twa-press-sm" onClick={() => { haptic.select(); setSelectMode(true); setSelectedTaskIds(new Set()); }}
                style={{ border: "none", borderRadius: 9, padding: "8px 12px", minHeight: 36, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: C.elevated, color: C.textSecondary }}>
                Выбрать
              </button>
            ) : (
              <>
                <button className="twa-press-sm" onClick={() => {
                  haptic.select();
                  const closableIds = activeTasks.filter(t => t.status !== "PURCHASING").map(t => t.id);
                  setSelectedTaskIds(prev => prev.size === closableIds.length ? new Set() : new Set(closableIds));
                }}
                  style={{ border: "none", borderRadius: 9, padding: "8px 12px", minHeight: 36, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: C.elevated, color: C.textSecondary }}>
                  {selectedTaskIds.size === activeTasks.filter(t => t.status !== "PURCHASING").length ? "Снять всё" : "Выбрать всё"}
                </button>
                <button className="twa-press-sm" onClick={() => { haptic.select(); setSelectMode(false); setSelectedTaskIds(new Set()); }}
                  style={{ border: "none", borderRadius: 9, padding: "8px 12px", minHeight: 36, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: C.elevated, color: C.textSecondary }}>
                  Отмена
                </button>
              </>
            )}
          </div>
        )}
        {selectMode && selectedTaskIds.size > 0 && (
          <Card>
            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e5e5ea" }}>
                  Выбрано: {selectedTaskIds.size}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.green, ...tabular }}>
                  {activeTasks.filter(t => selectedTaskIds.has(t.id)).reduce((s, t) => s + (t.priceRobux ?? t.purchasePriceRobux ?? 0), 0).toLocaleString("ru-RU")} R$
                </span>
              </div>
              <button className="twa-press" disabled={busy || bulkDoneRunning}
                onClick={() => { haptic.impact("heavy"); void doPartnerBulkMarkDone([...selectedTaskIds]); }}
                style={{
                  width: "100%", padding: "13px", border: "none", borderRadius: 12,
                  background: C.green, color: "#fff", fontSize: 15, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1,
                }}>
                {bulkDoneRunning ? "Отмечаю..." : `Выкуплено всё (${selectedTaskIds.size})`}
              </button>
            </div>
          </Card>
        )}
        <Card>
          {activeTasks.length === 0 ? (
            <div style={{ padding: "18px 16px", color: C.textSecondary, fontSize: 15, textAlign: "center" }}>
              {tasks.length === 0 ? "Задач пока нет" : "Нет активных задач"}
            </div>
          ) : (
            activeTasks.map((task, i) => (
              <div key={task.id} style={{ display: "flex", alignItems: "stretch" }}>
                {selectMode && task.status !== "PURCHASING" && (
                  <button
                    onClick={() => {
                      haptic.select();
                      setSelectedTaskIds(prev => {
                        const next = new Set(prev);
                        next.has(task.id) ? next.delete(task.id) : next.add(task.id);
                        return next;
                      });
                    }}
                    style={{
                      flexShrink: 0, width: 44, display: "flex", alignItems: "center", justifyContent: "center",
                      background: "none", border: "none", cursor: "pointer", padding: 0,
                    }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 6, border: `2px solid ${selectedTaskIds.has(task.id) ? C.green : C.textTertiary}`,
                      background: selectedTaskIds.has(task.id) ? C.green : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, color: "#fff", fontWeight: 700, transition: "all .15s",
                    }}>
                      {selectedTaskIds.has(task.id) && "✓"}
                    </span>
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: selectMode ? 0 : 16 }} />}
                  <PartnerTaskRow
                    task={task}
                    busy={busy}
                    rateUsdtPer1000={rate}
                    rateBasis={rateBasis}
                    robloxFeePct={robloxFeePct}
                    onPurchase={purchaseTask}
                    onMarkDone={(t) => { haptic.impact("medium"); void (async () => { if (await post("mark-done", { taskId: t.id, purchaseAccountName: accountName || null })) notifyBuyout([t.id]); })(); }}
                    onCancel={(t) => { haptic.impact("light"); post("cancel-task", { taskId: t.id }); }}
                  />
                </div>
              </div>
            ))
          )}
        </Card>
      </section>

      {/* Ручные пути добавления (запасные: основной поток — Google Sheets) спрятаны
          в свёрнутую секцию, чтобы не мешать операционному сценарию. */}
      <section>
        <button className="twa-press" onClick={() => { haptic.select(); setShowManualAdd(v => !v); }}
          style={{
            display: "flex", alignItems: "center", gap: 8, border: "none", background: "none",
            padding: "14px 4px 8px", cursor: "pointer", fontFamily: "inherit", width: "100%",
          }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textSecondary }}>
            Добавить вручную
          </span>
          <span style={{ marginLeft: "auto", fontSize: 14, color: C.textTertiary, transition: "transform .15s", transform: showManualAdd ? "rotate(90deg)" : "rotate(0)" }}>▶</span>
        </button>
        {showManualAdd && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card>
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <input value={gamepassInput} onChange={e => setGamepassInput(e.target.value)} placeholder="ID или URL геймпасса…"
                  style={{ width: "100%", background: C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 16, padding: "12px 14px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                <input value={nickInput} onChange={e => setNickInput(e.target.value)} placeholder="Ник продавца…"
                  style={{ width: "100%", background: C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "12px 14px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                <input value={noteInput} onChange={e => setNoteInput(e.target.value)} placeholder="Заметка…"
                  style={{ width: "100%", background: C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "12px 14px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                <button className="twa-press" onClick={() => { haptic.impact("medium"); createTask(); }} disabled={busy || !gamepassInput.trim()}
                  style={{ width: "100%", background: gamepassInput.trim() ? C.accent : C.elevated, border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 700, padding: "13px", cursor: busy ? "default" : "pointer", opacity: busy || !gamepassInput.trim() ? 0.55 : 1 }}>
                  Добавить задачу
                </button>
              </div>
            </Card>
            <Card>
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  style={{ display: "none" }}
                  onChange={(e) => importXlsx(e.target.files?.[0] ?? null)}
                />
                <button className="twa-press" onClick={() => { haptic.impact("medium"); uploadInputRef.current?.click(); }} disabled={busy}
                  style={{ width: "100%", background: C.elevated, border: "none", borderRadius: 10, color: C.accent, fontSize: 15, fontWeight: 700, padding: "13px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.55 : 1 }}>
                  Загрузить XLSX
                </button>
                <div style={{ color: C.textTertiary, fontSize: 13, lineHeight: 1.35 }}>Ожидаемые колонки: GP/ГП, Ник, Номинал.</div>
                {importResult && (
                  <div style={{ background: C.elevated, borderRadius: 10, overflow: "hidden" }}>
                    <InfoRow label="Строк" value={importResult.totalRows} />
                    <InfoRow label="Создано" value={importResult.created} />
                    <InfoRow label="Пропущено" value={importResult.skipped} />
                    <InfoRow label="Ошибки" value={importResult.failed} last />
                    {importResult.items.slice(0, 6).map((item) => (
                      <div key={`${item.row}-${item.gamepassId ?? item.message}`} style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}` }}>
                        <div style={{ color: "#e5e5ea", fontSize: 13, fontWeight: 700 }}>
                          Row {item.row}{item.gamepassId ? ` · GP ${item.gamepassId}` : ""}
                        </div>
                        <div style={{ color: item.status === "failed" ? C.red : item.status === "skipped" ? C.orange : C.textTertiary, fontSize: 12, marginTop: 3 }}>
                          {item.message}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </section>

      {confirmMismatchTask && (
        <PartnerMismatchConfirm
          task={confirmMismatchTask}
          rate={rate}
          rateBasis={rateBasis}
          robloxFeePct={robloxFeePct}
          busy={busy}
          onConfirm={async () => {
            haptic.impact("medium");
            const taskId = confirmMismatchTask.id;
            if (await post("purchase-task", { taskId })) notifyBuyout([taskId]);
            setConfirmMismatchTask(null);
          }}
          onCancel={() => { if (!busy) setConfirmMismatchTask(null); }}
        />
      )}

      {bulkReport && (
        <PartnerBatchReport report={bulkReport} onClose={() => setBulkReport(null)} />
      )}

      {showTopupSheet && (
        <PartnerTopupSheet
          busy={busy}
          onSubmit={topup}
          onClose={() => { if (!busy) setShowTopupSheet(false); }}
        />
      )}

      {showRateSheet && (
        <PartnerRateSheet
          busy={busy}
          currentRate={rate}
          purchaseRate={purchaseRate}
          rateBasis={rateBasis}
          robloxFeePct={robloxFeePct}
          rateChanges={rateChanges}
          rateReport={rateReport}
          onSubmit={saveRate}
          onClose={() => { if (!busy) setShowRateSheet(false); }}
        />
      )}

      {(() => {
        const compact = groupPartnerLedgerEntries(ledger as PartnerLedgerRow[]).slice(0, 3);
        return (
          <section>
            <button className="twa-press" onClick={() => openSubScreen("ledger")}
              style={{ width: "100%", minHeight: 44, padding: "8px 4px", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textSecondary }}>Ledger</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.accent }}>Все операции ›</span>
            </button>
            <Card>
              {compact.length === 0 ? (
                <div style={{ padding: "16px", color: C.textSecondary, fontSize: 15, textAlign: "center" }}>Операций пока нет</div>
              ) : compact.map((item, i) => {
                const entry = item.kind === "entry" ? item.entry : item.entries[0];
                const title = item.kind === "buyout-group"
                  ? `Выкуп 🎮 ${item.accountName}`
                  : item.entry.type === "TOPUP" ? "Пополнение" : item.entry.type;
                const detail = item.kind === "buyout-group"
                  ? `${item.totalItems} шт · ${item.totalRobux.toLocaleString("ru-RU")} R$`
                  : fmtPartnerDate(item.entry.createdAt);
                const amount = item.kind === "buyout-group" ? -item.totalUsdt : item.entry.amount;
                return (
                  <button key={`${item.kind}-${item.kind === "buyout-group" ? item.key : entry.id}-${i}`} className="twa-press" onClick={() => openSubScreen("ledger")}
                    style={{ width: "100%", minHeight: 52, padding: "11px 16px", border: "none", borderTop: i > 0 ? `1px solid ${C.border}` : "none", background: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", color: C.textPrimary, fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                      <span style={{ display: "block", marginTop: 2, color: C.textTertiary, fontSize: 14 }}>{detail}</span>
                    </span>
                    <span style={{ color: amount >= 0 ? C.green : C.red, fontSize: 15, fontWeight: 700, flexShrink: 0, ...tabular }}>
                      {amount > 0 ? "+" : ""}{amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {entry.currency}
                    </span>
                  </button>
                );
              })}
            </Card>
          </section>
        );
      })()}

      {subScreen && (() => {
        const pagedTasks = subScreenItems.filter((item): item is PartnerTask => "status" in item);
        const pagedLedger = subScreenItems.filter((item): item is PartnerLedgerEntry => "type" in item);
        const taskFilterOptions = subScreen === "bought"
          ? [
            { id: "all" as const, label: "Все" },
            { id: "done" as const, label: "Выкуплены" },
            { id: "cancelled" as const, label: "Отменены" },
          ]
          : [
            { id: "all" as const, label: "Все" },
            { id: "ready" as const, label: "Готовы" },
            { id: "failed" as const, label: "Ошибки" },
            { id: "done" as const, label: "Выкуплены" },
            { id: "cancelled" as const, label: "Отменены" },
          ];
        const filteredPagedTasks = subTaskFilter === "all" ? pagedTasks : pagedTasks.filter((task) => {
          if (subTaskFilter === "ready") return task.status === "READY" || task.status === "PURCHASING" || task.status === "NEW";
          if (subTaskFilter === "failed") return task.status === "FAILED";
          if (subTaskFilter === "done") return task.status === "DONE";
          return task.status === "CANCELLED";
        });
        const filteredPagedLedger = ledgerFilter === "all" ? pagedLedger : pagedLedger.filter((entry) => ledgerFilter === "topup" ? entry.type === "TOPUP" : entry.type === "BUYOUT" || entry.type === "REFUND");
        const ledgerTimeline = groupPartnerLedgerEntries(filteredPagedLedger as PartnerLedgerRow[]);
        const title = subScreen === "bought" ? "Выкуплено" : subScreen === "ledger" ? "Ledger" : "Задачи";
        const panelSummary = subScreen === "bought"
          ? `${(summary?.doneRobux ?? 0).toLocaleString("ru-RU")} R$ · ${summary?.done ?? 0} шт`
          : subScreen === "ledger"
            ? `Баланс ${fmtUsdt(summary?.balanceUsdt)} · потрачено ${fmtUsdt(summary?.spentUsdt)}`
            : `Всего ${summary?.total ?? 0} · в работе ${(summary?.ready ?? 0) + (summary?.purchasing ?? 0)}`;

        return (
          <PartnerSubScreenPanel title={title} summary={panelSummary} onClose={closeSubScreen}>
            {subScreen === "ledger" ? (
              <>
                {rateReport.length > 0 && (
                  <Card>
                    <div style={{ padding: "12px 14px 6px", fontSize: 14, fontWeight: 700, color: C.textSecondary }}>Выкуплено по курсам</div>
                    {rateReport.map((row, i) => (
                      <div key={`${row.rate ?? "unknown"}:${row.purchaseRate ?? "unknown"}:${row.rateBasis ?? "unknown"}`} style={{ minHeight: 48, padding: "10px 14px", borderTop: i > 0 ? `1px solid ${C.border}` : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontSize: 14, color: C.textSecondary }}>{row.rate === null ? "Курс не записан" : `${fmtRate(row.rate)} / 1000 ${row.rateBasis === "NET" ? "чистых" : "грязных"} R$`}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, ...tabular }}>{row.buyouts} шт · выручка {fmtUsdt(row.revenueUsdt)}</span>
                      </div>
                    ))}
                  </Card>
                )}
                <div style={{ display: "flex", gap: 7, margin: "12px 0" }}>
                  {([{"id":"all","label":"Все"},{"id":"topup","label":"Пополнения"},{"id":"buyout","label":"Списания"}] as const).map((option) => (
                    <button key={option.id} className="twa-press-sm" onClick={() => setLedgerFilter(option.id)}
                      style={{ minHeight: 44, flex: 1, border: "none", borderRadius: 10, background: ledgerFilter === option.id ? C.accent : C.elevated, color: ledgerFilter === option.id ? "#fff" : C.textSecondary, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <Card>
                  {ledgerTimeline.length === 0 && !subScreenLoading ? (
                    <div style={{ padding: 18, color: C.textSecondary, fontSize: 15, textAlign: "center" }}>Операций нет</div>
                  ) : ledgerTimeline.map((item, index) => {
                    if (item.kind === "entry") {
                      const entry = item.entry as PartnerLedgerEntry;
                      return (
                        <div key={entry.id} style={{ minHeight: 56, padding: "11px 14px", borderTop: index > 0 ? `1px solid ${C.border}` : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{entry.type === "TOPUP" ? "Пополнение" : entry.type === "REFUND" ? "Возврат" : entry.type === "ADJUSTMENT" ? "Корректировка" : entry.type}</div>
                            <div style={{ marginTop: 2, fontSize: 14, color: C.textTertiary }}>{fmtPartnerDate(entry.createdAt)}</div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: entry.amount >= 0 ? C.green : C.red, ...tabular }}>{entry.amount > 0 ? "+" : ""}{fmtUsdt(entry.amount)}</span>
                            {entry.type === "TOPUP" && !entry.taskId && (
                              <button className="twa-press-sm" onClick={() => setConfirmCancelTopup(entry)} disabled={busy} aria-label="Отменить пополнение"
                                style={{ width: 44, height: 44, border: "none", borderRadius: 10, background: tint(C.red, 0.14), color: C.red, fontSize: 17, cursor: "pointer" }}>✕</button>
                            )}
                          </div>
                        </div>
                      );
                    }
                    const groupId = `${item.key}-${index}`;
                    const expanded = expandedLedgerGroup === groupId;
                    return (
                      <div key={groupId} style={{ borderTop: index > 0 ? `1px solid ${C.border}` : "none" }}>
                        <button className="twa-press" onClick={() => setExpandedLedgerGroup(expanded ? null : groupId)}
                          style={{ width: "100%", minHeight: 62, padding: "11px 14px", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: C.textPrimary }}>🎮 {item.accountName}</span>
                            <span style={{ display: "block", marginTop: 3, fontSize: 14, color: C.textTertiary }}>{item.totalItems} геймпассов · {item.totalRobux.toLocaleString("ru-RU")} R$</span>
                          </span>
                          <span style={{ flexShrink: 0, textAlign: "right" }}>
                            <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: C.red, ...tabular }}>−{fmtUsdt(item.totalUsdt)}</span>
                            <span style={{ display: "block", marginTop: 2, fontSize: 14, color: C.textTertiary }}>{expanded ? "▲" : "▼"}</span>
                          </span>
                        </button>
                        {expanded && (() => {
                          const passes = [...new Map(item.entries.flatMap((entry) =>
                            entry.tasks?.length ? entry.tasks : entry.task ? [entry.task] : [],
                          ).map((task) => [task.id, task])).values()];
                          return passes.length > 0 ? passes.map((task) => (
                            <div key={task.id} style={{ padding: "9px 14px 9px 30px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <span style={{ minWidth: 0, fontSize: 14, color: C.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                ГП {task.gamepassId || "—"} · {task.robloxUsername || "без ника"}
                              </span>
                              <span style={{ flexShrink: 0, fontSize: 14, color: C.textPrimary, ...tabular }}>выкуплен</span>
                            </div>
                          )) : item.entries.map((entry) => (
                            <div key={entry.id} style={{ padding: "9px 14px 9px 30px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <span style={{ minWidth: 0, fontSize: 14, color: C.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>ГП {entry.reference || "—"}</span>
                              <span style={{ flexShrink: 0, fontSize: 14, color: C.textPrimary, ...tabular }}>{(entry.robuxAmount ?? 0).toLocaleString("ru-RU")} R$</span>
                            </div>
                          ));
                        })()}
                      </div>
                    );
                  })}
                </Card>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 10 }}>
                  {taskFilterOptions.map((option) => (
                    <button key={option.id} className="twa-press-sm" onClick={() => setSubTaskFilter(option.id)}
                      style={{ minHeight: 44, flexShrink: 0, padding: "0 14px", border: "none", borderRadius: 10, background: subTaskFilter === option.id ? C.accent : C.elevated, color: subTaskFilter === option.id ? "#fff" : C.textSecondary, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      {option.label}
                    </button>
                  ))}
                </div>
                <Card>
                  {filteredPagedTasks.length === 0 && !subScreenLoading ? (
                    <div style={{ padding: 18, color: C.textSecondary, fontSize: 15, textAlign: "center" }}>Задач нет</div>
                  ) : filteredPagedTasks.map((task, i) => (
                    <div key={task.id}>
                      {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
                      <PartnerTaskRow
                        task={task}
                        busy={busy}
                        rateUsdtPer1000={rate}
                        rateBasis={rateBasis}
                        robloxFeePct={robloxFeePct}
                        onPurchase={purchaseTask}
                        onMarkDone={(item) => { void (async () => { if (await post("mark-done", { taskId: item.id, purchaseAccountName: accountName || null })) notifyBuyout([item.id]); })(); }}
                        onCancel={(item) => { void post("cancel-task", { taskId: item.id }); }}
                      />
                    </div>
                  ))}
                </Card>
              </>
            )}
            {subScreenLoading && <div style={{ padding: 18, textAlign: "center", color: C.textSecondary, fontSize: 14 }}>Загружаю…</div>}
            {subScreenCursor && !subScreenLoading && (
              <button className="twa-press" onClick={() => void loadSubScreenPage(subScreen, subScreenCursor, true)}
                style={{ width: "100%", minHeight: 48, marginTop: 10, border: "none", borderRadius: 12, background: C.elevated, color: C.accent, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Показать ещё
              </button>
            )}
          </PartnerSubScreenPanel>
        );
      })()}

      {confirmCancelTopup && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget && !busy) setConfirmCancelTopup(null); }}>
          <div style={{ background: C.card, borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗑️</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>Отменить пополнение?</div>
            </div>
            <div style={{ background: C.elevated, borderRadius: 12, padding: "14px 16px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
                <span>Сумма</span>
                <span style={{ fontWeight: 700, color: "#e5e5ea", ...tabular }}>
                  +{confirmCancelTopup.amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {confirmCancelTopup.currency}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
                <span>Дата</span><span style={{ fontWeight: 700, color: "#e5e5ea" }}>{fmtPartnerDate(confirmCancelTopup.createdAt)}</span>
              </div>
            </div>
            <div style={{ background: tint(C.red, 0.1), borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 14, color: C.red, lineHeight: 1.35 }}>
              Исходная запись останется. В ledger появится видимое сторно на обратную сумму, баланс пересчитается.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="twa-press" onClick={() => setConfirmCancelTopup(null)} disabled={busy}
                style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Оставить
              </button>
              <button className="twa-press" disabled={busy}
                onClick={async () => {
                  haptic.impact("medium");
                  const ok = await post("cancel-ledger-entry", { entryId: confirmCancelTopup.id });
                  if (ok) toast("Пополнение отменено", "success");
                  setConfirmCancelTopup(null);
                }}
                style={{ flex: 1, padding: "13px 0", border: "none", borderRadius: 12, background: C.red, color: "#fff", fontSize: 15, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Провожу…" : "Провести сторно"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AccountHero({
  info,
  queueStats,
  errorCount,
  lastDrain,
  refreshing,
  onRefresh,
  onOpenMenu,
  onQueue,
  onErrors,
  onDrain,
  onHistory,
}: {
  info: AccountInfo | null;
  queueStats: OwnQueueStats | null;
  errorCount: number | null;
  lastDrain: { amount: number; createdAt: string } | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenMenu: () => void;
  onQueue: () => void;
  onErrors?: () => void;
  onDrain: () => void;
  onHistory: () => void;
}) {
  const balance = info?.balance ?? 0;
  const needed = Math.max(0, (queueStats?.dirty ?? 0) - balance);
  const progress = queueStats?.dirty ? Math.min(100, (balance / queueStats.dirty) * 100) : 100;
  const cookie = cookieAgeInfo(info?.cookieUpdatedAt ?? null);
  const queueLabel = queueStats ? `${queueStats.queue}` : "…";
  const drainLabel = balance > 0 && balance <= MAX_REMAINDER_DIRTY
    ? `${balance.toLocaleString("ru-RU")} R$`
    : lastDrain ? `${lastDrain.amount.toLocaleString("ru-RU")} R$` : "—";

  const rows = [
    { label: "Очередь", value: queueLabel, Icon: ShoppingBag, color: C.accent, onClick: onQueue },
    { label: "Ошибки", value: errorCount == null ? "…" : String(errorCount), Icon: CircleAlert, color: errorCount ? C.red : C.textSecondary, onClick: onErrors },
    { label: "Слив", value: drainLabel, Icon: Droplets, color: C.accent, onClick: onDrain },
    { label: "История", value: "", Icon: History, color: C.accent, onClick: onHistory },
  ];

  return (
    <>
      <section className="twa-account-hero">
        <div className="twa-account-hero-head">
          <div><small>Донор</small><strong><StatusDot valid={info?.cookieValid !== false} />{info?.accountName ?? "Не настроен"}</strong></div>
          <span className={cookie?.warn ? "is-warning" : ""}>{cookie?.text ?? "cookie не задан"}</span>
        </div>
        <div className="twa-account-balance-row">
          <div><strong>{info?.balance == null ? "—" : info.balance.toLocaleString("ru-RU")} <small>R$</small></strong><span>≈ {Math.floor(balance * 0.7).toLocaleString("ru-RU")} R$ чистыми</span></div>
          <div className="twa-account-hero-actions">
            <button type="button" className="twa-icon-button twa-press-sm" aria-label="Обновить баланс" onClick={onRefresh} disabled={refreshing}><RefreshCw size={18} className={refreshing ? "is-spinning" : ""} /></button>
            <button type="button" className="twa-icon-button twa-press-sm" aria-label="Настройки донора" onClick={onOpenMenu}><MoreHorizontal size={19} /></button>
          </div>
        </div>
        <div className="twa-account-queue-state">
          <div><span>{needed > 0 ? "Нужно пополнить донора" : queueStats?.queue ? "Баланс покрывает очередь" : "Очередь под контролем"}</span><strong>{queueStats?.queue ?? 0} заказов{needed > 0 ? ` · ${needed.toLocaleString("ru-RU")} R$` : ""}</strong></div>
          <button type="button" className="twa-press" onClick={onQueue}>{queueStats?.queue ? "К очереди" : "Проверить"}</button>
          <div className="twa-account-progress" aria-label={`Покрытие очереди ${Math.round(progress)}%`}><i style={{ width: `${progress}%` }} /></div>
        </div>
      </section>

      <div className="twa-account-operations">
        {rows.map(({ label, value, Icon, color, onClick }) => (
          <button type="button" className="twa-press-sm" key={label} onClick={onClick} disabled={!onClick}>
            <Icon size={18} color={color} />
            <span>{label}</span>
            {value && <b style={{ color: label === "Ошибки" && errorCount ? C.red : C.textPrimary }}>{value}</b>}
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Screen
// ═════════════════════════════════════════════════════════════════════════════
export default function BossrobuxScreen({ token, onOpenErrors }: { token: string; onOpenErrors?: () => void }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [workspace, setWorkspace] = useState<BuyoutWorkspace>("own");

  // ── Ф2: дашборд «Свои» — данные виджетов ────────────────────────────────
  const [queueStats, setQueueStats] = useState<OwnQueueStats | null>(null);
  const [todayStats, setTodayStats] = useState<{ count: number; dirty: number; errorCount: number } | null>(null);
  const [lastDrain, setLastDrain] = useState<{ amount: number; createdAt: string } | null>(null);
  const [showTxHistory, setShowTxHistory] = useState(false);
  const [showDrain, setShowDrain] = useState(false);
  const queueRef = useRef<HTMLElement | null>(null);
  const drainRef = useRef<HTMLElement | null>(null);
  const historyRef = useRef<HTMLElement | null>(null);

  const [cookieInput, setCookieInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // ── Search & Purchase state ─────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<GamepassItem[]>([]);
  const [resolvedUsername, setResolvedUsername] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const [confirmGp, setConfirmGp] = useState<GamepassItem | null>(null);
  const [attachGp, setAttachGp] = useState<GamepassItem | null>(null);
  // ➕ из результата поиска: ручной заказ с предзаполненным геймпассом.
  const [manualGp, setManualGp] = useState<GamepassItem | null>(null);
  // Дедуп Авито: сервер ответил 409 — на геймпасс уже есть активный заказ.
  const [avitoDup, setAvitoDup] = useState<{ gp: GamepassItem; saleRubles: number; existing: { wbCode: string; status: string } } | null>(null);
  const [buyoutKey, setBuyoutKey] = useState(0);
  const [buying, setBuying] = useState(false);
  const [boughtIds, setBoughtIds] = useState<Set<number>>(new Set());
  const buyLock = useRef(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [showCookie, setShowCookie] = useState(false);
  const [creatingAvito, setCreatingAvito] = useState(false);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const purchaseHeaders = { ...headers };

  // ── Account loading ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/twa/roblox-account", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setError("Ошибка загрузки"); return; }
      const d = await r.json().catch(() => null);
      if (!d) { setError("Ошибка загрузки"); return; }
      setInfo(d);
    } catch { setError("Ошибка сети"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Ф2: виджеты «Сегодня»/«Ошибки»/«Слив» — один лёгкий фетч первой страницы
  // DONE (в ней же counts.ERROR) + события сливов. Не зависит от свёрнутой
  // «Истории покупок» (она грузит ВСЕ страницы — потому и аккордеон).
  const loadOwnStats = useCallback(async () => {
    const hdrs = { Authorization: `Bearer ${token}` };
    try {
      const r = await fetch(`/api/twa/orders?status=DONE&limit=50&lite=1`, { headers: hdrs });
      if (r.ok) {
        const d = await r.json();
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        const today = (d.orders ?? []).filter((o: TxOrder) => new Date(o.updatedAt) >= midnight);
        setTodayStats({
          count: today.length,
          dirty: today.reduce((s: number, o: TxOrder) => s + Math.ceil(o.amount / 0.7), 0),
          errorCount: d.counts?.ERROR ?? 0,
        });
      }
    } catch { /* виджеты не критичны */ }
    try {
      const r = await fetch(`/api/twa/drain?events=1`, { headers: hdrs });
      const j = r.ok ? await r.json() : null;
      const ev = Array.isArray(j?.events) ? j.events[0] : null;
      setLastDrain(ev ? { amount: ev.amount, createdAt: ev.createdAt } : null);
    } catch { }
  }, [token]);

  useEffect(() => { loadOwnStats(); }, [loadOwnStats]);

  const handleQueueStats = useCallback((s: OwnQueueStats) => setQueueStats(s), []);

  const scrollToSection = (ref: React.MutableRefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openHistory = () => {
    setShowTxHistory(true);
    window.setTimeout(() => scrollToSection(historyRef), 0);
  };

  const revealFirstHistoryRow = useCallback(() => {
    const firstRow = historyRef.current?.querySelector<HTMLElement>(".twa-history-row");
    (firstRow ?? historyRef.current)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  async function refreshBalance() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/twa/roblox-account", {
        method: "POST", headers,
        body: JSON.stringify({ action: "refresh-balance" }),
      });
      const d = await r.json();
      if (!r.ok) {
        haptic.notify("error");
        setSaveMsg({ text: d.error ?? "Ошибка", ok: false });
        return;
      }
      setInfo(prev => prev ? { ...prev, accountName: d.accountName, accountId: d.accountId, balance: d.balance, cookieValid: true } : prev);
      haptic.notify("success");
    } catch { haptic.notify("error"); }
    finally { setRefreshing(false); }
  }

  async function saveCookie() {
    if (!cookieInput.trim()) return;
    setSaving(true); setSaveMsg(null);
    try {
      const r = await fetch("/api/twa/roblox-account", {
        method: "POST", headers,
        body: JSON.stringify({ action: "set-cookie", cookie: cookieInput.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) {
        haptic.notify("error");
        setSaveMsg({ text: d?.error ?? (r.status >= 500 ? "Сервер недоступен — попробуй позже" : "Ошибка сохранения") , ok: false });
        return;
      }
      haptic.notify("success");
      setSaveMsg({ text: `Сохранено · ${d.accountName}`, ok: true });
      setCookieInput("");
      setInfo({
        hasCookie: true, cookieValid: true,
        cookieUpdatedAt: new Date().toISOString(),
        accountName: d.accountName, accountId: d.accountId, balance: d.balance,
      });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch { haptic.notify("error"); setSaveMsg({ text: "Ошибка сети — проверь подключение", ok: false }); }
    finally { setSaving(false); }
  }

  // ── Search (auto-detect: URL → ID → nick) ──────────────────────────────
  async function doSearch() {
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true); setSearchError(""); setSearchResults([]); setResolvedUsername(""); setHasSearched(true);
    setBoughtIds(new Set());

    const urlMatch = q.match(/game-pass(?:es)?\/(\d+)/i);
    const isIdLike = !urlMatch && /^\d{6,}$/.test(q);
    const searchById = !!(urlMatch || isIdLike);
    const gamepassId = urlMatch ? urlMatch[1] : q;

    try {
      if (searchById) {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "resolve-gamepass", gamepassId }),
        });
        const d = await r.json();
        if (!r.ok) { setSearchError(d.error ?? "Ошибка"); return; }
        setResolvedUsername(d.sellerName ?? "");
        setSearchResults([d]);
      } else {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "search-by-username", username: q }),
        });
        const d = await r.json();
        if (!r.ok) { setSearchError(d.error ?? "Ошибка"); return; }
        setResolvedUsername(d.username ?? q);
        setSearchResults(d.gamepasses ?? []);
        if ((d.gamepasses ?? []).length === 0) setSearchError(d.msg ?? "Геймпассы не найдены");
      }
      haptic.notify("success");
    } catch { setSearchError("Ошибка сети"); haptic.notify("error"); }
    finally { setSearching(false); }
  }

  // ── Purchase ────────────────────────────────────────────────────────────
  async function doPurchase() {
    if (!confirmGp || buyLock.current) return;
    buyLock.current = true;
    setBuying(true);

    try {
      // If we came from nick-search, we need sellerId via resolve
      let { productId, sellerId } = confirmGp as GamepassItem & { sellerId?: number };
      const price = confirmGp.price;

      if (!productId || !sellerId) {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "resolve-gamepass", gamepassId: String(confirmGp.gamepassId) }),
        });
        const d = await r.json();
        if (!r.ok || !d.productId) {
          haptic.notify("error");
          setSearchError(d.error ?? "Не удалось получить данные ГП");
          setConfirmGp(null);
          return;
        }
        productId = d.productId;
        sellerId = d.sellerId;
        if (d.isManagedPricing) {
          setConfirmGp(prev => prev ? { ...prev, isManagedPricing: true, basePriceInRobux: d.basePriceInRobux, sellerId: d.sellerId, productId: d.productId } : prev);
        }
      }

      const r = await fetch("/api/twa/roblox-account/purchase", {
        method: "POST", headers: purchaseHeaders,
        // gamepassId — для серверного guard'а «неоплаченный прямой заказ» (П5).
        body: JSON.stringify({ action: "purchase", productId, price, sellerId, gamepassId: confirmGp.gamepassId }),
      });
      const d = await r.json();

      if (r.status === 409) {
        haptic.notify("error");
        setSearchError(d.error ?? "Заказ не оплачен");
        setConfirmGp(null);
        return;
      }
      if (d.success) {
        haptic.notify("success");
        setBoughtIds(prev => new Set(prev).add(confirmGp!.gamepassId));
        if (d.balance !== null && d.balance !== undefined) {
          setInfo(prev => prev ? { ...prev, balance: d.balance } : prev);
        }
        setConfirmGp(null);
      } else {
        haptic.notify("error");
        setSearchError(d.msg ?? d.error ?? "Ошибка покупки");
        setConfirmGp(null);
      }
    } catch {
      haptic.notify("error");
      setSearchError("Ошибка сети");
      setConfirmGp(null);
    } finally {
      setBuying(false);
      buyLock.current = false;
    }
  }

  // ── Create Avito from search result ─────────────────────────────────────
  async function createAvitoFromSearch(gp: GamepassItem, force = false, knownSaleRubles?: number) {
    if (creatingAvito) return;
    const entered = knownSaleRubles === undefined ? window.prompt("За сколько продали на Авито, ₽?", "") : String(knownSaleRubles);
    if (entered === null) return;
    const saleRubles = Number(entered.replace(",", "."));
    if (!Number.isFinite(saleRubles) || saleRubles <= 0) {
      haptic.notify("error");
      toast("Нужна цена продажи в ₽", "error");
      return;
    }
    setCreatingAvito(true);
    try {
      const amount = Math.floor(gp.price * 0.7);
      const gamepassUrl = `https://www.roblox.com/game-pass/${gp.gamepassId}`;
      const r = await fetch("/api/twa/orders", {
        method: "POST", headers,
        body: JSON.stringify({
          action: "create-avito",
          amount,
          saleRubles,
          gamepassUrl,
          robloxUsername: gp.sellerName || null,
          note: null,
          force,
        }),
      });
      const d = await r.json();
      // Дедуп: на этот геймпасс уже есть активный заказ → спрашиваем менеджера.
      if (r.status === 409 && d.existing) {
        haptic.notify("warning");
        setAvitoDup({ gp, saleRubles, existing: d.existing });
        return;
      }
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast(`Авито · ${gp.name} · ${amount} R$`, "success");
      setHistoryKey(k => k + 1);
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setCreatingAvito(false); }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) return <Skeleton />;
  if (error) return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <div style={{ color: C.red, fontSize: 16, marginBottom: 12 }}>{error}</div>
      <button className="twa-press" onClick={load} style={{
        background: C.card, border: "none", borderRadius: 10,
        color: C.accent, fontSize: 15, fontWeight: 600, padding: "12px 28px", cursor: "pointer",
      }}>Повторить</button>
    </div>
  );

  const cookieReady = info?.hasCookie && info?.cookieValid !== false;
  const browserAvailable = cookieReady && !info?.browserUnavailable;

  return (
    <div className="twa-account-calm" style={{ padding: "10px 16px 32px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", height: "100%" }}>
      <WorkspaceSwitch value={workspace} onChange={setWorkspace} />

      {workspace === "own" ? (
        <>
          <AccountHero
            info={info}
            queueStats={queueStats}
            errorCount={todayStats?.errorCount ?? null}
            lastDrain={lastDrain}
            refreshing={refreshing}
            onRefresh={() => { haptic.impact("light"); void refreshBalance(); }}
            onOpenMenu={() => { haptic.impact("light"); setShowCookie(value => !value); }}
            onQueue={() => scrollToSection(queueRef)}
            onErrors={onOpenErrors}
            onDrain={() => { setShowDrain(true); window.setTimeout(() => scrollToSection(drainRef), 0); }}
            onHistory={openHistory}
          />
          {/* ── Ф2: hero «Донор» + виджеты — зеркало языка дашборда Антона (5.9).
              Виджеты кликабельны: Очередь/Слив скроллят к секции, Ошибки —
              переход на вкладку Заказы/ERROR (язык 5.10). */}
          <section className="twa-account-legacy-summary" aria-hidden="true">
            <SectionHeader
              title="Донор"
              hint={cookieAgeInfo(info?.cookieUpdatedAt ?? null)?.text ?? null}
              hintColor={cookieAgeInfo(info?.cookieUpdatedAt ?? null)?.warn ? C.yellow : undefined}
            />
            <Card>
              {info?.hasCookie ? (
                <div style={{ padding: "16px 16px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>
                      <StatusDot valid={info.cookieValid !== false} />
                      {info.accountName ?? "Неизвестный"}
                      {info.cookieValid === false && <span style={{ marginLeft: 8, color: C.red }}>Cookie истёк</span>}
                    </div>
                    <div style={{ marginTop: 3, fontSize: 34, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.15, color: C.textPrimary, ...tabular }}>
                      {info.balance !== null ? info.balance.toLocaleString("ru-RU") : "—"}
                      <span style={{ fontSize: 17, fontWeight: 600, color: C.textSecondary, marginLeft: 6 }}>R$</span>
                    </div>
                    {info.balance !== null && (
                      <div style={{ marginTop: 2, fontSize: 14, color: C.textTertiary, ...tabular }}>
                        ≈ {Math.floor(info.balance * 0.7).toLocaleString("ru-RU")} R$ чистыми
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      className="twa-press"
                      onClick={() => { haptic.impact("light"); refreshBalance(); }}
                      disabled={refreshing}
                      title="Обновить баланс"
                      style={{
                        minHeight: 44, minWidth: 44, border: "none", borderRadius: 12,
                        background: tint(C.accent, 0.14), color: C.accent, fontSize: 18,
                        cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.55 : 1,
                        fontFamily: "inherit",
                      }}
                    >
                      {refreshing ? "…" : "🔄"}
                    </button>
                    <button
                      className="twa-press"
                      onClick={() => { haptic.impact("light"); setShowCookie(v => !v); }}
                      style={{
                        minHeight: 44, padding: "0 14px", border: "none", borderRadius: 12,
                        background: C.elevated, color: showCookie ? C.orange : C.textSecondary,
                        fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      🔑
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: "20px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🔑</div>
                  <div style={{ fontSize: 16, color: C.textSecondary }}>Cookie не задан</div>
                  <div style={{ fontSize: 14, color: C.textTertiary, marginTop: 4 }}>Вставьте .ROBLOSECURITY — кнопка 🔑</div>
                  <button
                    className="twa-press"
                    onClick={() => { haptic.impact("light"); setShowCookie(v => !v); }}
                    style={{
                      marginTop: 12, minHeight: 40, padding: "0 18px", border: "none", borderRadius: 10,
                      background: C.elevated, color: showCookie ? C.orange : C.accent,
                      fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    🔑 Cookie
                  </button>
                </div>
              )}
              <div style={{ height: 1, background: C.border, marginLeft: 16 }} />
              {/* Виджеты 2×2 (О4): Очередь / Сегодня / Ошибки / Слив. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 12 }}>
                <StatTile
                  label="Очередь"
                  value={queueStats ? `${queueStats.queue} шт` : "…"}
                  sub={queueWidgetSub(queueStats)}
                  subColor={queueStats && queueStats.queue > 0 && queueStats.affordable === 0 ? C.red : undefined}
                  onClick={cookieReady ? () => scrollToSection(queueRef) : undefined}
                />
                <StatTile
                  label="Сегодня"
                  value={todayStats ? `${todayStats.count} шт` : "…"}
                  sub={todayStats ? `− ${todayStats.dirty.toLocaleString("ru-RU")} R$ спущено` : null}
                />
                <StatTile
                  label="Ошибки"
                  value={todayStats ? String(todayStats.errorCount) : "…"}
                  valueColor={todayStats && todayStats.errorCount > 0 ? C.red : undefined}
                  sub={todayStats ? (todayStats.errorCount > 0 ? "открыть ERROR ›" : "всё чисто") : null}
                  subColor={todayStats && todayStats.errorCount > 0 ? C.red : undefined}
                  onClick={onOpenErrors}
                />
                <StatTile
                  label="Слив"
                  value={
                    info?.balance !== null && info?.balance !== undefined && info.balance > 0 && info.balance <= MAX_REMAINDER_DIRTY
                      ? "Пора сливать"
                      : lastDrain ? `${lastDrain.amount.toLocaleString("ru-RU")} R$` : "—"
                  }
                  valueColor={
                    info?.balance !== null && info?.balance !== undefined && info.balance > 0 && info.balance <= MAX_REMAINDER_DIRTY
                      ? C.orange : undefined
                  }
                  sub={
                    info?.balance !== null && info?.balance !== undefined && info.balance > 0 && info.balance <= MAX_REMAINDER_DIRTY
                      ? `остаток ${info.balance.toLocaleString("ru-RU")} R$`
                      : lastDrain ? `слив ${fmtPartnerDate(lastDrain.createdAt)}` : "сливов ещё не было"
                  }
                  onClick={() => { setShowDrain(true); window.setTimeout(() => scrollToSection(drainRef), 0); }}
                />
              </div>
            </Card>

            {showCookie && (
              <div style={{ marginTop: 10 }}>
                <Card>
                  <div style={{ padding: 12 }}>
                    <textarea
                      value={cookieInput}
                      onChange={e => setCookieInput(e.target.value)}
                      placeholder=".ROBLOSECURITY значение…"
                      rows={3}
                      style={{
                        width: "100%", background: C.elevated, border: "none", borderRadius: 10,
                        color: "#fff", fontSize: 15, padding: "12px 14px",
                        resize: "vertical", outline: "none", fontFamily: "monospace",
                        lineHeight: 1.4, boxSizing: "border-box",
                      }}
                    />
                    <button
                      className="twa-press"
                      onClick={() => { haptic.impact("medium"); saveCookie(); }}
                      disabled={saving || !cookieInput.trim()}
                      style={{
                        marginTop: 8, width: "100%",
                        background: cookieInput.trim() ? C.green : C.elevated,
                        border: "none", borderRadius: 10,
                        color: "#fff", fontSize: 15, fontWeight: 600,
                        padding: "14px", cursor: saving ? "default" : "pointer",
                        opacity: saving || !cookieInput.trim() ? 0.5 : 1,
                        transition: "background 0.2s, opacity 0.2s",
                      }}
                    >
                      {saving ? "Проверяю…" : "💾 Сохранить cookie"}
                    </button>
                  </div>
                </Card>

                {saveMsg && (
                  <div style={{
                    marginTop: 8, padding: "10px 14px", borderRadius: 10,
                    background: saveMsg.ok ? `${C.green}22` : `${C.red}22`,
                    color: saveMsg.ok ? C.green : C.red,
                    fontSize: 15, fontWeight: 500,
                  }}>
                    {saveMsg.ok ? "✅" : "❌"} {saveMsg.text}
                  </div>
                )}
              </div>
            )}
          </section>

          {showCookie && (
            <section className="twa-account-cookie-sheet twa-fade-up">
              <div className="twa-account-cookie-head"><KeyRound size={18} /><div><strong>Cookie донора</strong><small>Редкое действие · значение не показывается после сохранения</small></div></div>
              <textarea value={cookieInput} onChange={event => setCookieInput(event.target.value)} placeholder=".ROBLOSECURITY значение…" rows={3} />
              <button type="button" className="twa-press" onClick={() => { haptic.impact("medium"); void saveCookie(); }} disabled={saving || !cookieInput.trim()}>{saving ? "Проверяю…" : "Проверить и сохранить"}</button>
              {saveMsg && <span className={saveMsg.ok ? "is-success" : "is-error"}>{saveMsg.text}</span>}
            </section>
          )}

          {/* ── Search & Purchase (FIRST — main function) ────────────────────
              Поиск ходит в публичные Roblox API и работает без cookie — секция
              видна всегда (раньше пряталась целиком при протухшем cookie или
              таймауте Roblox, «пропал поиск»). Без cookie дизейблится только 🛒. */}
          <section className="twa-account-search-section">
          <SectionHeader title="Поиск и выкуп" />

          <Card>
            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="twa-account-search-input"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && searchInput.trim()) doSearch(); }}
                  placeholder="Ник, ID или URL геймпасса…"
                  style={{
                    flex: 1, background: C.elevated, border: "none", borderRadius: 10,
                    color: "#fff", fontSize: 16, padding: "12px 14px",
                    outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                    minWidth: 0,
                  }}
                />
                <button
                  className="twa-account-search-button twa-press"
                  aria-label="Найти геймпасс"
                  onClick={() => { haptic.impact("light"); doSearch(); }}
                  disabled={searching || !searchInput.trim()}
                  style={{
                    flexShrink: 0, padding: "12px 18px", border: "none", borderRadius: 10,
                    background: searchInput.trim() ? C.accent : C.elevated,
                    color: "#fff", fontSize: 16, fontWeight: 600, cursor: searching ? "default" : "pointer",
                    opacity: searching || !searchInput.trim() ? 0.5 : 1,
                    fontFamily: "inherit", transition: "all 0.2s",
                  }}
                >
                  {searching ? "…" : <Search size={19} />}
                </button>
              </div>
            </div>

            {/* Results */}
            {searchResults.length > 0 && (
              <>
                {resolvedUsername && (
                  <div style={{
                    padding: "10px 14px", fontSize: 14, color: C.textTertiary,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    {searchResults.length > 1
                      ? `${resolvedUsername} · ${searchResults.length} геймпасс${searchResults.length < 5 ? "а" : "ов"}`
                      : resolvedUsername
                    }
                  </div>
                )}
                {searchResults.map((gp, i) => (
                  <div key={gp.gamepassId}>
                    {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 14 }} />}
                    <GamepassCard
                      gp={gp}
                      buying={buying && confirmGp?.gamepassId === gp.gamepassId}
                      bought={boughtIds.has(gp.gamepassId)}
                      onBuy={() => setConfirmGp(gp)}
                      buyDisabled={!cookieReady}
                      onCreateAvito={() => createAvitoFromSearch(gp)}
                      creatingAvito={creatingAvito}
                      onAttach={() => { haptic.impact("light"); setAttachGp(gp); }}
                      onCreateOrder={() => { haptic.impact("light"); setManualGp(gp); }}
                    />
                  </div>
                ))}
              </>
            )}

            {/* Error / empty */}
            {searchError && (
              <div style={{
                padding: "14px 14px", fontSize: 15, color: C.textSecondary, textAlign: "center",
                borderTop: hasSearched ? `1px solid ${C.border}` : "none",
              }}>
                {searchError}
              </div>
            )}
          </Card>

          {!cookieReady && (
            <div style={{ marginTop: 8, padding: "0 4px", fontSize: 13, color: C.textTertiary }}>
              {info?.browserUnavailable
                ? "⚠️ Браузерный сервис недоступен — поиск и баланс работают, автовыкуп временно недоступен"
                : "🔑 Cookie не задан или истёк — поиск работает, выкуп недоступен"}
            </div>
          )}
        </section>

      {/* ── Buyout Orders ───────────────────────────────────────────────── */}
      {cookieReady && (
        <section ref={queueRef}>
          <SectionHeader title="Очередь" hint={queueStats ? `${queueStats.queue} заказов` : null} />
          <BuyoutSection
            key={buyoutKey}
            token={token}
            balance={info?.balance ?? null}
            accountName={info?.accountName ?? null}
            onBalanceChange={(delta) => setInfo(prev => prev && prev.balance !== null ? { ...prev, balance: prev.balance + delta } : prev)}
            onStats={handleQueueStats}
          />
        </section>
      )}

      {/* ── Слив остатка донора → мой аккаунт ────────────────────────────── */}
      <section ref={drainRef}>
        <button type="button" className="twa-drain-summary twa-press-sm" onClick={() => { haptic.select(); setShowDrain(value => !value); }}>
          <span className="twa-result-icon">💧</span>
          <span><strong>Слив остатка</strong><small>{info?.accountName ?? "Донор не определён"} · {info?.balance == null ? "баланс —" : `${info.balance.toLocaleString("ru-RU")} R$`} · {lastDrain ? `последний ${lastDrain.amount.toLocaleString("ru-RU")} R$ ${fmtPartnerDate(lastDrain.createdAt)}` : "сливов ещё не было"}</small></span>
          <span>{showDrain ? "⌃" : "⌄"}</span>
        </button>
        {showDrain && <div className="twa-fade-up" style={{ marginTop: 10 }}>
          <DrainSection
            token={token}
            onDonorBalance={(b) => setInfo(prev => prev ? { ...prev, balance: b } : prev)}
          />
        </div>}
      </section>

      {/* ── Transaction History — аккордеон: грузит ВСЕ страницы DONE,
             поэтому по умолчанию свёрнута и монтируется только по тапу (Ф2). */}
      <section ref={historyRef}>
        <button
          className="twa-press-sm"
          onClick={() => { haptic.select(); setShowTxHistory(v => !v); }}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
            padding: "0 4px", marginBottom: 8,
            fontSize: 14, fontWeight: 600, color: C.textSecondary,
            textTransform: "uppercase", letterSpacing: 0.6,
          }}
        >
          <span>История покупок</span>
          <span style={{ marginLeft: "auto", fontSize: 14, color: C.textTertiary, transition: "transform .15s", transform: showTxHistory ? "rotate(90deg)" : "rotate(0)" }}>▶</span>
        </button>
        {showTxHistory && <TransactionHistory key={historyKey} token={token} onReady={revealFirstHistoryRow} />}
      </section>

      {/* Confirm modal */}
      {confirmGp && (
        <ConfirmPurchase
          gp={confirmGp}
          buying={buying}
          onConfirm={doPurchase}
          onCancel={() => { if (!buying) setConfirmGp(null); }}
        />
      )}

      {/* Attach-to-order modal */}
      {attachGp && (
        <AttachOrderModal
          gp={attachGp}
          token={token}
          onClose={() => setAttachGp(null)}
          onAttached={() => setBuyoutKey(k => k + 1)}
        />
      )}

      {/* ➕ Ручной заказ из результата поиска (общая модалка с Orders) */}
      {manualGp && (
        <CreateManualModal
          token={token}
          initialGamepassUrl={`https://www.roblox.com/game-pass/${manualGp.gamepassId}`}
          initialNick={manualGp.sellerName}
          initialAmount={Math.floor(manualGp.price * 0.7)}
          onClose={() => setManualGp(null)}
          onDone={() => { setManualGp(null); setBuyoutKey(k => k + 1); setHistoryKey(k => k + 1); }}
        />
      )}

      {/* Avito dedup confirm: активный заказ на этот геймпасс уже есть */}
      {avitoDup && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}
          onClick={e => { if (e.target === e.currentTarget && !creatingAvito) setAvitoDup(null); }}
        >
          <div style={{ background: C.card, borderRadius: 16, padding: 20, width: "100%", maxWidth: 340 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#e5e5ea", marginBottom: 8 }}>
              ⚠️ Заказ уже есть
            </div>
            <div style={{ fontSize: 15, color: C.textSecondary, lineHeight: 1.45, marginBottom: 16 }}>
              Геймпасс <b style={{ color: "#e5e5ea" }}>{avitoDup.gp.name}</b> уже в заказе{" "}
              <b style={{ color: C.orange }}>{avitoDup.existing.wbCode}</b>{" "}
              ({ORDER_STATUS_RU[avitoDup.existing.status] ?? avitoDup.existing.status}).
              Создать ещё один?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="twa-press"
                onClick={() => setAvitoDup(null)}
                disabled={creatingAvito}
                style={{
                  flex: 1, padding: "12px 0", border: "none", borderRadius: 10,
                  background: C.elevated, color: "#e5e5ea", fontSize: 15, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Отмена
              </button>
              <button
                className="twa-press"
                onClick={() => { const { gp, saleRubles } = avitoDup; setAvitoDup(null); createAvitoFromSearch(gp, true, saleRubles); }}
                disabled={creatingAvito}
                style={{
                  flex: 1, padding: "12px 0", border: "none", borderRadius: 10,
                  background: C.orange, color: "#fff", fontSize: 15, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Создать ещё
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      ) : (
        <PartnerAntonSection token={token} accountName={info?.accountName ?? null} />
      )}
    </div>
  );
}
