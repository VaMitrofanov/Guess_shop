import { createHash } from "crypto";

import { after, NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { Prisma, type Partner, type PartnerBuyoutTask } from "@prisma/client";

import {
  batchUpdateGoogleSheetValues,
  googleCellRange,
  isGoogleSheetsConfigured,
  listGoogleSheets,
  readGoogleSheetRows,
  type GoogleSheetsValueUpdate,
} from "@/lib/google-sheets";
import { BuyoutError, parseGamepassId, purchaseGamepassWithCookie, resolveGamepass } from "@/lib/roblox-buyout";
import { prisma } from "@/lib/prisma";
import { extractTwaUser } from "@/lib/twa-auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

type TwaUser = Awaited<ReturnType<typeof extractTwaUser>>;

const PARTNER_NAME_BY_SLUG: Record<string, string> = {
  anton: "Антон",
};
const DEFAULT_PARTNER_CURRENCY = "USDT";
const DEFAULT_ANTON_RATE_USDT_PER_1000_R = 5.05;
const PARTNER_SCHEMA_NOT_READY = "PARTNER_SCHEMA_NOT_READY";
const PARTNER_SCHEMA_NOT_READY_MESSAGE = "Партнёрский раздел требует применения новых миграций на сервере";
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_XLSX_ROWS = 300;
const GOOGLE_SYNC_TTL_MS = 60_000;
const GOOGLE_SYNC_RUNNING_STALE_MS = 2 * 60_000;
const GOOGLE_STATUS_PENDING = "в ожидании";
const GOOGLE_STATUS_DONE = "готово";
// Чип «ошибка» в колонке статуса: строка подсвечивается красным условным форматированием
// на стороне таблицы, причина пишется в колонку «комментарий». Ставим его только для
// row-level проблем, которые Антон может исправить; внутренние ошибки операций
// (cookie, баланс партнёра) колонку статуса не трогают.
const GOOGLE_STATUS_ERROR = "ошибка";
const GOOGLE_CANCELLED_COMMENT = "Отменено менеджером";
const GOOGLE_MAX_SHEETS = 80;
const GOOGLE_MAX_ROWS_PER_SHEET = 800;
// П9 (2026-07-10): владелец удалил старый столбец B — актуальная структура листа:
// A=ник, B=айди геймпасса, C=номинал грязными, D=статус заказа, E=комментарий.
const SHEET_COL = { nickname: 0, gamepass: 1, amount: 2, status: 3, comment: 4 } as const;
const SHEET_GAMEPASS_LETTER = "B";
const SHEET_AMOUNT_LETTER = "C";
const SHEET_STATUS_LETTER = "D";
const SHEET_COMMENT_LETTER = "E";
const SHEET_READ_RANGE = `A:${SHEET_COMMENT_LETTER}`;
const SHEET_CELL_COUNT = 5;
const ACTIVE_TASK_STATUSES = ["NEW", "READY", "FAILED"] as const;

type ParsedPartnerImportRow = {
  rowNumber: number;
  gamepassId: string | null;
  gamepassInput: string;
  robuxAmount: number | null;
  sheetPriceRobux: number | null;
  robloxUsername: string | null;
  robloxUserId: string | null;
  raw: Record<string, unknown>;
};

type PartnerImportResult = {
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
};

type GoogleSyncItem = {
  sheet: string;
  row: number;
  gamepassId: string | null;
  status: "created" | "updated" | "skipped" | "failed";
  message: string;
};

type GoogleSyncFilterStats = {
  readRows: number;
  amountFilledRows: number;
  pendingStatusRows: number;
  matchedRows: number;
  emptyAmountRows: number;
  nonPendingStatusRows: number;
  statusCounts: Record<string, number>;
};

type GoogleSyncSheetDiagnostics = GoogleSyncFilterStats & {
  title: string;
};

type GoogleSyncReconciliationStats = {
  closedFromSheet: number;
  failedFromSheet: number;
  cancelledFromSheet: number;
  deletedFromSheet: number;
  /** DONE-задачи, чью строку удалили из таблицы: деньги/статус не трогаем, только бейдж. */
  doneMarkedDeleted: number;
  revived: number;
  conflicts: number;
};

type GoogleSyncDiagnostics = GoogleSyncFilterStats & {
  sheets: GoogleSyncSheetDiagnostics[];
  reconciliation?: GoogleSyncReconciliationStats;
};

type GoogleSyncResult = {
  status: "success" | "partial" | "failed" | "skipped";
  sheetCount: number;
  rowCount: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  diagnostics: GoogleSyncDiagnostics;
  items: GoogleSyncItem[];
  error?: string;
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function isPartnerSchemaNotReadyError(err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2010", "P2021", "P2022"].includes(err.code);
  }

  const text = err instanceof Error ? err.message : String(err ?? "");
  const lower = text.toLowerCase();
  const partnerField = [
    "partner",
    "partnerbuyouttask",
    "partnerledgerentry",
    "partnerimportrun",
    "ledgercurrency",
    "robuxrateusdtper1000",
    "googlesheet",
    "externalsource",
    "xlsx_upload",
    "createdcount",
  ].some((needle) => lower.includes(needle));
  const schemaSignal = [
    "does not exist",
    "unknown argument",
    "unknown field",
    "column",
    "relation",
    "enum",
    "database",
  ].some((needle) => lower.includes(needle));

  return partnerField && schemaSignal;
}

function partnerSchemaNotReadyResponse() {
  return json({
    ok: false,
    code: PARTNER_SCHEMA_NOT_READY,
    error: PARTNER_SCHEMA_NOT_READY_MESSAGE,
  }, 503);
}

function operatorLabel(user: NonNullable<TwaUser>) {
  return `${user.firstName || "TWA"}:${user.userId}`;
}

function getAntonGoogleSheetConfig() {
  const googleSheetId = process.env.ANTON_GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!googleSheetId) return {};

  return {
    googleSheetId,
    googleSheetUrl: `https://docs.google.com/spreadsheets/d/${googleSheetId}/edit`,
  };
}

function getTaskPrice(task: Pick<PartnerBuyoutTask, "priceRobux" | "purchasePriceRobux">) {
  return task.purchasePriceRobux ?? task.priceRobux ?? 0;
}

function moneyCurrency(partner: Pick<Partner, "ledgerCurrency">) {
  return partner.ledgerCurrency || DEFAULT_PARTNER_CURRENCY;
}

function taskCostUsdt(robuxPrice: number, partner: Pick<Partner, "robuxRateUsdtPer1000">) {
  return Math.round((robuxPrice * partner.robuxRateUsdtPer1000 / 1000) * 100) / 100;
}

function normalizeImportHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]/g, "");
}

function getImportValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeImportHeader);
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeImportHeader(key))) return value;
  }
  return null;
}

function parseImportNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/\s/g, "");
  const normalized = /^\d{1,3}([,.]\d{3})+$/.test(text)
    ? text.replace(/[,.]/g, "")
    : text.replace(",", ".");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGoogleStatus(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function createGoogleFilterStats(): GoogleSyncFilterStats {
  return {
    readRows: 0,
    amountFilledRows: 0,
    pendingStatusRows: 0,
    matchedRows: 0,
    emptyAmountRows: 0,
    nonPendingStatusRows: 0,
    statusCounts: {},
  };
}

function createGoogleDiagnostics(): GoogleSyncDiagnostics {
  return {
    ...createGoogleFilterStats(),
    sheets: [],
  };
}

function bumpGoogleFilterStats(stats: GoogleSyncFilterStats, input: {
  hasAmount: boolean;
  isPending: boolean;
  status: string;
}) {
  const statusKey = input.status || "(empty)";
  stats.readRows += 1;
  stats.statusCounts[statusKey] = (stats.statusCounts[statusKey] ?? 0) + 1;

  if (input.hasAmount) stats.amountFilledRows += 1;
  else stats.emptyAmountRows += 1;

  if (input.isPending) stats.pendingStatusRows += 1;
  else stats.nonPendingStatusRows += 1;

  if (input.hasAmount && input.isPending) stats.matchedRows += 1;
}

function buildGoogleExternalRowId(spreadsheetId: string, sheetTitle: string, rowNumber: number) {
  return `${spreadsheetId}:${sheetTitle}:${rowNumber}`;
}

function truncateGoogleMessage(value: unknown) {
  return String(value ?? "").trim().slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function computeGoogleRowHash(cells: unknown[]) {
  const normalized = Array.from({ length: SHEET_CELL_COUNT }, (_, i) => String(cells[i] ?? "").trim());
  return createHash("sha1").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

function buildGoogleSheetRaw(input: {
  spreadsheetId: string;
  sheetTitle: string;
  sheetId?: number | null;
  rowNumber: number;
  cells: unknown[];
  syncedBy?: string | null;
  sheetPriceRobux?: number | null;
  priceMismatch?: boolean;
}) {
  return toJsonObject({
    source: "google-sheets",
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle,
    sheetId: input.sheetId ?? null,
    rowNumber: input.rowNumber,
    range: `${input.sheetTitle}!A${input.rowNumber}:${SHEET_COMMENT_LETTER}${input.rowNumber}`,
    cells: input.cells,
    rowHash: computeGoogleRowHash(input.cells),
    sheetPriceRobux: input.sheetPriceRobux ?? null,
    priceMismatch: input.priceMismatch ?? false,
    syncedAt: new Date().toISOString(),
    syncedBy: input.syncedBy || null,
  });
}

function getGoogleTaskMeta(task: Pick<PartnerBuyoutTask, "externalSource" | "sheetRaw">) {
  if (task.externalSource !== "GOOGLE_SHEETS" || !isRecord(task.sheetRaw)) return null;

  const spreadsheetId = String(task.sheetRaw.spreadsheetId || "").trim();
  const sheetTitle = String(task.sheetRaw.sheetTitle || "").trim();
  const rowNumber = Number(task.sheetRaw.rowNumber);
  if (!spreadsheetId || !sheetTitle || !Number.isInteger(rowNumber) || rowNumber < 1) return null;

  return { spreadsheetId, sheetTitle, rowNumber, raw: task.sheetRaw };
}

function mergeTaskSheetRaw(task: Pick<PartnerBuyoutTask, "sheetRaw">, patch: Record<string, unknown>) {
  return toJsonObject({
    ...(isRecord(task.sheetRaw) ? task.sheetRaw : {}),
    ...patch,
  });
}

function extractGamepassIdFromImport(input: string) {
  const gamepassMatch = input.match(/game-pass(?:es)?\/(\d+)/i);
  if (gamepassMatch?.[1]) return gamepassMatch[1];

  const numericMatch = input.match(/\b(\d{5,})\b/);
  return numericMatch?.[1] ?? null;
}

function importFileKey(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80) || "upload";
}

function toJsonObject(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function parsePartnerXlsx(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new BuyoutError("В XLSX нет листов", 400);

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });

  if (rows.length > MAX_XLSX_ROWS) {
    throw new BuyoutError(`Слишком много строк: максимум ${MAX_XLSX_ROWS}`, 400);
  }

  return rows
    .map((row, index): ParsedPartnerImportRow => {
      const gamepassValue = getImportValue(row, [
        "gamepass",
        "gamepassid",
        "gamepassurl",
        "gp",
        "гп",
        "ссылкагп",
        "ссылка",
        "url",
      ]);
      const usernameValue = getImportValue(row, [
        "robloxusername",
        "username",
        "nick",
        "nickname",
        "ник",
        "никроблокс",
      ]);
      const amountValue = getImportValue(row, [
        "robuxamount",
        "robux",
        "amount",
        "номинал",
        "чистые",
        "r",
      ]);
      const priceValue = getImportValue(row, [
        "gamepassprice",
        "price",
        "cost",
        "цена",
        "ценагп",
        "грязные",
      ]);
      const userIdValue = getImportValue(row, [
        "robloxuserid",
        "userid",
        "user",
        "robloxid",
        "id",
      ]);
      const gamepassInput = String(gamepassValue ?? "").trim();

      return {
        rowNumber: index + 2,
        gamepassId: extractGamepassIdFromImport(gamepassInput),
        gamepassInput,
        robuxAmount: parseImportNumber(amountValue),
        sheetPriceRobux: parseImportNumber(priceValue),
        robloxUsername: String(usernameValue ?? "").trim() || null,
        robloxUserId: String(userIdValue ?? "").trim() || null,
        raw: row,
      };
    })
    .filter((row) => row.gamepassInput || row.robloxUsername || row.robuxAmount || row.sheetPriceRobux);
}

async function readPartnerPostBody(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return {
      body: (await req.json().catch(() => ({}))) as Record<string, unknown>,
      file: null as File | null,
    };
  }

  const formData = await req.formData();
  const body: Record<string, unknown> = {};
  let file: File | null = null;

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      body[key] = value;
    } else if (key === "file") {
      file = value;
    }
  }

  return { body, file };
}

async function importPartnerXlsx(partner: Partner, user: NonNullable<TwaUser>, file: File | null) {
  if (!file) throw new BuyoutError("Приложите XLSX-файл", 400);
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new BuyoutError("Поддерживается только .xlsx", 400);
  if (file.size > MAX_XLSX_BYTES) throw new BuyoutError("XLSX слишком большой: максимум 5 MB", 400);

  const rows = parsePartnerXlsx(Buffer.from(await file.arrayBuffer()));
  const result: PartnerImportResult = {
    totalRows: rows.length,
    created: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };
  const sourceFile = importFileKey(file.name);

  for (const row of rows) {
    if (!row.gamepassId) {
      result.failed += 1;
      result.items.push({
        row: row.rowNumber,
        gamepassId: null,
        status: "failed",
        message: "Не найден ID геймпасса",
      });
      continue;
    }

    const externalRowId = `xlsx:${sourceFile}:row${row.rowNumber}:gp${row.gamepassId}`;
    const duplicate = await prisma.partnerBuyoutTask.findFirst({
      where: {
        partnerId: partner.id,
        OR: [
          {
            gamepassId: row.gamepassId,
            status: { not: "CANCELLED" },
          },
          {
            externalSource: "XLSX_UPLOAD",
            externalRowId,
          },
        ],
      },
      select: { id: true, status: true },
    });
    if (duplicate) {
      result.skipped += 1;
      result.items.push({
        row: row.rowNumber,
        gamepassId: row.gamepassId,
        status: "skipped",
        message: `Уже есть задача ${duplicate.status}`,
      });
      continue;
    }

    const baseTask = {
      partnerId: partner.id,
      externalSource: "XLSX_UPLOAD" as const,
      externalRowId,
      robloxUsername: row.robloxUsername,
      gamepassId: row.gamepassId,
      gamepassUrl: `https://www.roblox.com/game-pass/${row.gamepassId}`,
      note: row.robuxAmount ? `Номинал: ${row.robuxAmount} R$` : null,
      sheetRaw: toJsonObject({
        source: "twa-xlsx",
        fileName: file.name,
        row: row.rowNumber,
        robuxAmount: row.robuxAmount,
        sheetPriceRobux: row.sheetPriceRobux,
        robloxUserId: row.robloxUserId,
        importedBy: operatorLabel(user),
        raw: row.raw,
      }),
    };

    try {
      const gp = await resolveGamepass(row.gamepassInput || row.gamepassId);
      const ready = Boolean(gp.isForSale && gp.price && gp.price > 0 && gp.productId && gp.sellerId);

      await prisma.partnerBuyoutTask.create({
        data: {
          ...baseTask,
          status: ready ? "READY" : "FAILED",
          productId: gp.productId ? String(gp.productId) : null,
          sellerId: gp.sellerId ? String(gp.sellerId) : null,
          sellerName: gp.sellerName || null,
          priceRobux: gp.price || row.sheetPriceRobux || null,
          error: ready ? null : "Геймпасс не продаётся или нет productId/sellerId",
        },
      });

      result.created += 1;
      result.items.push({
        row: row.rowNumber,
        gamepassId: row.gamepassId,
        status: "created",
        message: ready ? "Готова к выкупу" : "Создана с ошибкой проверки",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ошибка проверки геймпасса";
      await prisma.partnerBuyoutTask.create({
        data: {
          ...baseTask,
          status: "FAILED",
          priceRobux: row.sheetPriceRobux || null,
          error: message,
        },
      });

      result.created += 1;
      result.items.push({
        row: row.rowNumber,
        gamepassId: row.gamepassId,
        status: "created",
        message: `Создана с ошибкой: ${message}`,
      });
    }
  }

  return result;
}

/**
 * kind="done"      -> D="готово", E очищается.
 * kind="error"     -> D="ошибка" (красная строка у Антона) + причина в E («комментарий»).
 *                     Строка выходит из фильтра «в ожидании» до ручного исправления.
 * kind="comment"   -> только E; D не трогаем (внутренние ошибки операций: cookie,
 *                     баланс партнёра — строка должна остаться «в ожидании»).
 * kind="cancelled" -> D="ошибка" + E="Отменено менеджером": отмена из TWA должна быть
 *                     видна Антону. Успешная запись ставит cancelWriteBackAt — только
 *                     после неё возврат D в «в ожидании» реанимирует задачу.
 */
async function writeBackPartnerTask(task: PartnerBuyoutTask, kind: "done" | "error" | "comment" | "cancelled", message?: string) {
  const meta = getGoogleTaskMeta(task);
  if (!meta || !isGoogleSheetsConfigured()) return;

  const errorMessage = truncateGoogleMessage(
    message || (kind === "cancelled" ? GOOGLE_CANCELLED_COMMENT : task.error) || "Ошибка обработки",
  );
  const updates: GoogleSheetsValueUpdate[] = kind === "done"
    ? [
      { range: googleCellRange(meta.sheetTitle, SHEET_STATUS_LETTER, meta.rowNumber), values: [[GOOGLE_STATUS_DONE]] },
      { range: googleCellRange(meta.sheetTitle, SHEET_COMMENT_LETTER, meta.rowNumber), values: [[""]] },
    ]
    : kind === "error" || kind === "cancelled"
      ? [
        { range: googleCellRange(meta.sheetTitle, SHEET_STATUS_LETTER, meta.rowNumber), values: [[GOOGLE_STATUS_ERROR]] },
        { range: googleCellRange(meta.sheetTitle, SHEET_COMMENT_LETTER, meta.rowNumber), values: [[errorMessage]] },
      ]
      : [
        { range: googleCellRange(meta.sheetTitle, SHEET_COMMENT_LETTER, meta.rowNumber), values: [[errorMessage]] },
      ];

  try {
    await batchUpdateGoogleSheetValues(meta.spreadsheetId, updates);
    await prisma.partnerBuyoutTask.update({
      where: { id: task.id },
      data: {
        sheetRaw: mergeTaskSheetRaw(task, {
          writeBackAt: new Date().toISOString(),
          lastWriteBackError: null,
          ...(kind === "cancelled" ? { cancelWriteBackAt: new Date().toISOString() } : {}),
        }),
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Ошибка записи в Google Sheets";
    await prisma.partnerBuyoutTask.update({
      where: { id: task.id },
      data: {
        sheetRaw: mergeTaskSheetRaw(task, {
          lastWriteBackError: error,
          lastWriteBackFailedAt: new Date().toISOString(),
        }),
      },
    });
  }
}

type GoogleTaskUpsertData = {
  status: "READY" | "FAILED";
  robloxUsername: string | null;
  gamepassId: string | null;
  gamepassUrl: string | null;
  productId?: string | null;
  sellerId?: string | null;
  sellerName?: string | null;
  priceRobux: number | null;
  error: string | null;
  note?: string | null;
};

/**
 * П7: skip no-op-обновлений. Каждый sync раньше переписывал все совпавшие задачи,
 * из-за чего updatedAt «прыгал» и список пересортировывался. Обновляем только если
 * изменилось содержимое строки (rowHash), результат резолва или флаг расхождения.
 */
function isGoogleTaskUnchanged(existing: PartnerBuyoutTask, data: GoogleTaskUpsertData, input: {
  rowHash: string;
  priceMismatch: boolean;
  sheetId: number | null;
}) {
  const raw = isRecord(existing.sheetRaw) ? existing.sheetRaw : null;
  return existing.status === data.status
    && (existing.robloxUsername ?? null) === (data.robloxUsername ?? null)
    && (existing.gamepassId ?? null) === (data.gamepassId ?? null)
    && (existing.gamepassUrl ?? null) === (data.gamepassUrl ?? null)
    && (existing.productId ?? null) === (data.productId ?? null)
    && (existing.sellerId ?? null) === (data.sellerId ?? null)
    && (existing.sellerName ?? null) === (data.sellerName ?? null)
    && (existing.priceRobux ?? null) === (data.priceRobux ?? null)
    && (existing.error ?? null) === (data.error ?? null)
    && (existing.note ?? null) === (data.note ?? null)
    && raw?.rowHash === input.rowHash
    && Boolean(raw?.priceMismatch) === input.priceMismatch
    && (raw?.sheetId ?? null) === (input.sheetId ?? null);
}

type ReconcileOutcome = {
  kind: "closed" | "failed" | "cancelled" | "conflict";
  message: string;
};

/**
 * Строку удалили/очистили в таблице — задача удаляется из TWA полностью (решение
 * владельца 2026-07-10). Guard: если по задаче уже есть ledger-записи (не должно быть
 * у активных, но деньги дороже), не удаляем, а отменяем с заметкой.
 */
async function deletePartnerTaskForRemovedRow(
  task: PartnerBuyoutTask,
  stats: GoogleSyncReconciliationStats,
  reason: string,
) {
  const ledgerCount = await prisma.partnerLedgerEntry.count({ where: { taskId: task.id } });
  if (ledgerCount > 0) {
    await prisma.partnerBuyoutTask.update({
      where: { id: task.id },
      data: {
        status: "CANCELLED",
        note: `${reason}; задача не удалена — по ней есть ledger-записи`,
        sheetRaw: mergeTaskSheetRaw(task, { cancelledFromSheet: true, reconciledAt: new Date().toISOString() }),
      },
    });
    stats.cancelledFromSheet += 1;
    return "cancelled" as const;
  }

  await prisma.partnerBuyoutTask.delete({ where: { id: task.id } });
  stats.deletedFromSheet += 1;
  return "deleted" as const;
}

/**
 * П3: реконсиляция ручной правки статуса D для существующей задачи GOOGLE_SHEETS
 * в активном статусе (NEW/READY/FAILED). Денег не двигает: «готово» из таблицы
 * закрывает задачу БЕЗ списания USDT (бейдж «из таблицы», решение о «Списать» отложено).
 */
async function reconcilePartnerGoogleRow(input: {
  task: PartnerBuyoutTask;
  rowStatus: string;
  rowComment: string;
  rowGamepassId: string | null;
  stats: GoogleSyncReconciliationStats;
}): Promise<ReconcileOutcome | null> {
  const { task, rowStatus, rowGamepassId, stats } = input;
  if (!(ACTIVE_TASK_STATUSES as readonly string[]).includes(task.status)) return null;

  // Защита от сдвига нумерации (вставили/удалили строки выше): если в B теперь другой
  // геймпасс, чужую строку не закрываем и не отменяем — только конфликт-метка.
  if (rowGamepassId && task.gamepassId && rowGamepassId !== task.gamepassId) {
    const conflict = `Строка сместилась: в ${SHEET_GAMEPASS_LETTER} геймпасс ${rowGamepassId}, в задаче ${task.gamepassId} — проверь вручную`;
    stats.conflicts += 1;
    if ((isRecord(task.sheetRaw) ? task.sheetRaw.conflict : null) === conflict) {
      return { kind: "conflict", message: conflict };
    }
    await prisma.partnerBuyoutTask.update({
      where: { id: task.id },
      data: { sheetRaw: mergeTaskSheetRaw(task, { conflict, conflictAt: new Date().toISOString() }) },
    });
    return { kind: "conflict", message: conflict };
  }

  if (rowStatus === GOOGLE_STATUS_DONE) {
    await prisma.partnerBuyoutTask.update({
      where: { id: task.id },
      data: {
        status: "DONE",
        completedAt: new Date(),
        error: null,
        note: "Закрыто из таблицы: D=«готово» выставлено вручную",
        sheetRaw: mergeTaskSheetRaw(task, {
          closedFromSheet: true,
          conflict: null,
          reconciledAt: new Date().toISOString(),
        }),
      },
    });
    stats.closedFromSheet += 1;
    return { kind: "closed", message: "Закрыта из таблицы (D=готово), без списания USDT" };
  }

  if (rowStatus === GOOGLE_STATUS_ERROR) {
    // FAILED + D=«ошибка» — консистентно (наш же write-back), не трогаем.
    if (task.status === "FAILED") return null;
    const reason = input.rowComment ? `Помечено ошибкой в таблице: ${input.rowComment}` : "Помечено ошибкой в таблице";
    await prisma.partnerBuyoutTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        error: truncateGoogleMessage(reason),
        sheetRaw: mergeTaskSheetRaw(task, { errorFromSheet: true, reconciledAt: new Date().toISOString() }),
      },
    });
    stats.failedFromSheet += 1;
    return { kind: "failed", message: "Помечена ошибкой из таблицы" };
  }

  const statusLabel = rowStatus || "пусто";
  await prisma.partnerBuyoutTask.update({
    where: { id: task.id },
    data: {
      status: "CANCELLED",
      note: `Строка вышла из ожидания: статус «${statusLabel}»`,
      sheetRaw: mergeTaskSheetRaw(task, { cancelledFromSheet: true, reconciledAt: new Date().toISOString() }),
    },
  });
  stats.cancelledFromSheet += 1;
  return { kind: "cancelled", message: `Отменена: D=«${statusLabel}»` };
}

async function syncPartnerGoogleSheets(partner: Partner, user: TwaUser, options: { force?: boolean } = {}) {
  const result: GoogleSyncResult = {
    status: "skipped",
    sheetCount: 0,
    rowCount: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    diagnostics: createGoogleDiagnostics(),
    items: [],
  };
  const spreadsheetId = partner.googleSheetId?.trim();
  if (!spreadsheetId) return { ...result, error: "Google Sheet ID не задан" };
  if (!isGoogleSheetsConfigured()) return { ...result, error: "Google service account не настроен" };

  if (!options.force) {
    const latestRun = await prisma.partnerImportRun.findFirst({
      where: { partnerId: partner.id, source: "GOOGLE_SHEETS" },
      orderBy: { startedAt: "desc" },
    });
    if (latestRun?.finishedAt && Date.now() - latestRun.finishedAt.getTime() < GOOGLE_SYNC_TTL_MS) {
      return {
        ...result,
        sheetCount: latestRun.sheetCount,
        rowCount: latestRun.rowCount,
        created: latestRun.createdCount,
        updated: latestRun.updatedCount,
        skipped: latestRun.skippedCount,
        failed: latestRun.failedCount,
        diagnostics: isRecord(latestRun.diagnostics) ? latestRun.diagnostics as GoogleSyncDiagnostics : createGoogleDiagnostics(),
        error: "Sync недавно уже выполнялся",
      };
    }
    if (latestRun?.status === "RUNNING" && Date.now() - latestRun.startedAt.getTime() < GOOGLE_SYNC_RUNNING_STALE_MS) {
      return { ...result, error: "Sync уже выполняется" };
    }
  }

  const run = await prisma.partnerImportRun.create({
    data: {
      partnerId: partner.id,
      source: "GOOGLE_SHEETS",
      spreadsheetId,
      createdBy: user ? operatorLabel(user) : null,
    },
  });
  const writeBacks: GoogleSheetsValueUpdate[] = [];
  const reconciliation: GoogleSyncReconciliationStats = {
    closedFromSheet: 0,
    failedFromSheet: 0,
    cancelledFromSheet: 0,
    deletedFromSheet: 0,
    doneMarkedDeleted: 0,
    revived: 0,
    conflicts: 0,
  };
  result.diagnostics.reconciliation = reconciliation;

  try {
    const existingTasks = await prisma.partnerBuyoutTask.findMany({
      where: { partnerId: partner.id, externalSource: "GOOGLE_SHEETS" },
    });
    const tasksByRowId = new Map<string, PartnerBuyoutTask>();
    for (const task of existingTasks) {
      if (task.externalRowId) tasksByRowId.set(task.externalRowId, task);
    }
    const seenRowIds = new Set<string>();
    const scannedSheetTitles = new Set<string>();
    // Guard реконсиляции «строка удалена»: не отменяем задачи, если скан обрезан лимитами.
    let scanComplete = true;

    const allSheets = await listGoogleSheets(spreadsheetId);
    if (allSheets.length > GOOGLE_MAX_SHEETS) scanComplete = false;
    const sheets = allSheets.slice(0, GOOGLE_MAX_SHEETS);
    result.sheetCount = sheets.length;

    for (const sheet of sheets) {
      const allRows = (await readGoogleSheetRows(spreadsheetId, sheet.title, SHEET_READ_RANGE)).values;
      if (allRows.length > GOOGLE_MAX_ROWS_PER_SHEET) scanComplete = false;
      const rows = allRows.slice(0, GOOGLE_MAX_ROWS_PER_SHEET);
      scannedSheetTitles.add(sheet.title);
      const sheetDiagnostics: GoogleSyncSheetDiagnostics = {
        title: sheet.title,
        ...createGoogleFilterStats(),
      };
      result.diagnostics.sheets.push(sheetDiagnostics);

      for (let index = 0; index < rows.length; index += 1) {
        const cells = rows[index] || [];
        const rowNumber = index + 1;
        const externalRowId = buildGoogleExternalRowId(spreadsheetId, sheet.title, rowNumber);
        seenRowIds.add(externalRowId);
        const nominal = cells[SHEET_COL.amount];
        const status = normalizeGoogleStatus(cells[SHEET_COL.status]);
        const hasAmount = String(nominal ?? "").trim() !== "";
        const isPending = status === GOOGLE_STATUS_PENDING;
        bumpGoogleFilterStats(result.diagnostics, { hasAmount, isPending, status });
        bumpGoogleFilterStats(sheetDiagnostics, { hasAmount, isPending, status });
        const rowItem = (statusOverride: GoogleSyncItem["status"], gamepassId: string | null, message: string) => {
          result.items.push({ sheet: sheet.title, row: rowNumber, gamepassId, status: statusOverride, message });
        };

        const gamepassInput = String(cells[SHEET_COL.gamepass] ?? "").trim();
        const gamepassId = parseGamepassId(gamepassInput);
        const existing = tasksByRowId.get(externalRowId) ?? null;
        // Строку очистили (A:C пустые, чип D мог остаться предвыставленным «в ожидании») —
        // это удаление заказа: задача уходит из TWA полностью. D=«готово»/«ошибка» не трогаем:
        // готово — операционная история, ошибка — наш же write-back.
        const rowCleared = [SHEET_COL.nickname, SHEET_COL.gamepass, SHEET_COL.amount]
          .every((i) => String(cells[i] ?? "").trim() === "");
        if (rowCleared && existing && status !== GOOGLE_STATUS_DONE && status !== GOOGLE_STATUS_ERROR) {
          // DONE/PURCHASING не трогаем и «готово» в очищенную строку не переписываем:
          // Антон мог очистить строку под переиспользование.
          if (existing.status === "DONE" || existing.status === "PURCHASING") continue;
          const outcome = await deletePartnerTaskForRemovedRow(existing, reconciliation, "Строка очищена в таблице");
          result.updated += 1;
          rowItem("updated", existing.gamepassId, outcome === "deleted"
            ? "Удалена из TWA: строка очищена в таблице"
            : "Отменена: строка очищена, но по задаче есть ledger-записи");
          continue;
        }

        if (!isPending) {
          // Реконсиляция ручных статусов: D сменили руками — приводим внутреннюю задачу
          // в соответствие (готово -> DONE без списания, ошибка -> FAILED, прочее -> CANCELLED).
          if (existing) {
            const outcome = await reconcilePartnerGoogleRow({
              task: existing,
              rowStatus: status,
              rowComment: String(cells[SHEET_COL.comment] ?? "").trim(),
              rowGamepassId: gamepassId,
              stats: reconciliation,
            });
            if (outcome) {
              if (outcome.kind === "conflict") result.skipped += 1;
              else result.updated += 1;
              rowItem(outcome.kind === "conflict" ? "skipped" : "updated", existing.gamepassId, outcome.message);
            }
          }
          continue;
        }
        // Пустой номинал (C) у строки без задачи и без ГП в B — шаблонная строка с
        // предвыставленным чипом «в ожидании», молча пропускаем. Но если задача уже есть
        // или в B есть ГП, строка настоящая: пустой номинал = ошибка строки, а не повод
        // для зомби-задачи.
        if (!hasAmount && !existing && !gamepassId) continue;

        result.rowCount += 1;
        const sheetPrice = parseImportNumber(nominal);
        const rowHash = computeGoogleRowHash(cells);
        const existingRaw = existing && isRecord(existing.sheetRaw) ? existing.sheetRaw : null;
        // CANCELLED реанимируем обычным импортом, если отмену видел Антон: отмены самой
        // реконсиляции (cancelledFromSheet) и отмены менеджера, дошедшие до таблицы
        // write-back'ом (cancelWriteBackAt). Возврат D в «в ожидании» = явный повторный заказ.
        const existingRevivableCancelled = existing?.status === "CANCELLED" && (
          existingRaw?.cancelledFromSheet === true
          || (existingRaw?.cancelledByManager === true && Boolean(existingRaw?.cancelWriteBackAt))
        );

        if (existing?.status === "DONE") {
          result.skipped += 1;
          rowItem("skipped", existing.gamepassId, "Задача уже выполнена");
          writeBacks.push(
            { range: googleCellRange(sheet.title, SHEET_STATUS_LETTER, rowNumber), values: [[GOOGLE_STATUS_DONE]] },
            { range: googleCellRange(sheet.title, SHEET_COMMENT_LETTER, rowNumber), values: [[""]] },
          );
          continue;
        }
        if (existing?.status === "PURCHASING" || (existing?.status === "CANCELLED" && !existingRevivableCancelled)) {
          result.skipped += 1;
          rowItem("skipped", existing.gamepassId, `Задача сейчас в статусе ${existing.status}`);
          // Отмена менеджера, не дошедшая до таблицы (write-back упал): строка всё ещё
          // «в ожидании» — допишем отмену, чтобы Антон её увидел.
          if (existing.status === "CANCELLED" && existingRaw?.cancelledByManager === true && !existingRaw?.cancelWriteBackAt) {
            await writeBackPartnerTask(existing, "cancelled");
          }
          continue;
        }

        if (!gamepassId || !sheetPrice || sheetPrice <= 0) {
          const message = !gamepassId
            ? `Не найден ID геймпасса в колонке ${SHEET_GAMEPASS_LETTER}`
            : !hasAmount
              ? `Пустой номинал в колонке ${SHEET_AMOUNT_LETTER}`
              : `Некорректный номинал в колонке ${SHEET_AMOUNT_LETTER}`;
          const data = {
            partnerId: partner.id,
            externalSource: "GOOGLE_SHEETS" as const,
            externalRowId,
            status: "FAILED" as const,
            robloxUsername: String(cells[SHEET_COL.nickname] ?? "").trim() || null,
            gamepassId,
            gamepassUrl: gamepassId ? `https://www.roblox.com/game-pass/${gamepassId}` : null,
            priceRobux: sheetPrice ? Math.round(sheetPrice) : null,
            error: message,
            sheetRaw: buildGoogleSheetRaw({
              spreadsheetId,
              sheetTitle: sheet.title,
              sheetId: sheet.sheetId,
              rowNumber,
              cells,
              syncedBy: user ? operatorLabel(user) : null,
              sheetPriceRobux: sheetPrice ? Math.round(sheetPrice) : null,
            }),
          };
          if (existing && isGoogleTaskUnchanged(existing, data, { rowHash, priceMismatch: false, sheetId: sheet.sheetId })) {
            result.skipped += 1;
            result.failed += 1;
            rowItem("skipped", gamepassId, `${message} (без изменений)`);
            writeBacks.push(
              { range: googleCellRange(sheet.title, SHEET_STATUS_LETTER, rowNumber), values: [[GOOGLE_STATUS_ERROR]] },
              { range: googleCellRange(sheet.title, SHEET_COMMENT_LETTER, rowNumber), values: [[message]] },
            );
            continue;
          }
          if (existing) {
            await prisma.partnerBuyoutTask.update({ where: { id: existing.id }, data });
            result.updated += 1;
            if (existingRevivableCancelled) reconciliation.revived += 1;
            rowItem("updated", gamepassId, message);
          } else {
            await prisma.partnerBuyoutTask.create({ data });
            result.created += 1;
            rowItem("created", gamepassId, message);
          }
          result.failed += 1;
          writeBacks.push(
            { range: googleCellRange(sheet.title, SHEET_STATUS_LETTER, rowNumber), values: [[GOOGLE_STATUS_ERROR]] },
            { range: googleCellRange(sheet.title, SHEET_COMMENT_LETTER, rowNumber), values: [[message]] },
          );
          continue;
        }

        try {
          const gp = await resolveGamepass(gamepassInput || gamepassId);
          const ready = Boolean(gp.isForSale && gp.price && gp.price > 0 && gp.productId && gp.sellerId);
          const gpPrice = gp.price || Math.round(sheetPrice);
          const roundedSheetPrice = Math.round(sheetPrice);
          const priceMismatch = Boolean(gp.price && roundedSheetPrice !== gp.price);
          const mismatchNote = priceMismatch
            ? `Номинал из Sheets: ${roundedSheetPrice} R$, цена GP: ${gp.price} R$`
            : `Номинал из Sheets: ${roundedSheetPrice} R$`;
          // Расхождение «номинал C vs live-цена ГП» — ошибка строки (решение владельца
          // 2026-07-10): задача FAILED, в D пишется «ошибка», причина — в E. Антон правит
          // C (или цену ГП) и возвращает D в «в ожидании» — задача снова станет READY.
          const mismatchWarning = priceMismatch ? `Цена ГП: ${gp.price} R$, в таблице ${roundedSheetPrice} R$` : null;
          const rowOk = ready && !priceMismatch;
          const message = !ready
            ? "Геймпасс не продаётся или нет productId/sellerId"
            : mismatchWarning ?? "Готова к выкупу";
          const data = {
            partnerId: partner.id,
            externalSource: "GOOGLE_SHEETS" as const,
            externalRowId,
            status: rowOk ? "READY" as const : "FAILED" as const,
            robloxUsername: String(cells[SHEET_COL.nickname] ?? "").trim() || null,
            gamepassId: String(gp.gamepassId || gamepassId),
            gamepassUrl: `https://www.roblox.com/game-pass/${gp.gamepassId || gamepassId}`,
            productId: gp.productId ? String(gp.productId) : null,
            sellerId: gp.sellerId ? String(gp.sellerId) : null,
            sellerName: gp.sellerName || null,
            priceRobux: gpPrice,
            // Для расхождения error не дублируем: warning-блок в карточке рисуется
            // по sheetRaw.priceMismatch.
            error: ready ? null : message,
            note: mismatchNote,
            sheetRaw: buildGoogleSheetRaw({
              spreadsheetId,
              sheetTitle: sheet.title,
              sheetId: sheet.sheetId,
              rowNumber,
              cells,
              syncedBy: user ? operatorLabel(user) : null,
              sheetPriceRobux: roundedSheetPrice,
              priceMismatch,
            }),
          };
          // Строка сейчас «в ожидании», а задача не ок — write-back нужен и на skip-пути:
          // прошлый batch мог упасть, либо Антон вернул D в «в ожидании», не исправив строку.
          const errorWriteBack: GoogleSheetsValueUpdate[] = rowOk ? [] : [
            { range: googleCellRange(sheet.title, SHEET_STATUS_LETTER, rowNumber), values: [[GOOGLE_STATUS_ERROR]] },
            { range: googleCellRange(sheet.title, SHEET_COMMENT_LETTER, rowNumber), values: [[!ready ? message : mismatchWarning ?? message]] },
          ];

          if (existing && isGoogleTaskUnchanged(existing, data, { rowHash, priceMismatch, sheetId: sheet.sheetId })) {
            result.skipped += 1;
            if (!rowOk) result.failed += 1;
            writeBacks.push(...errorWriteBack);
            rowItem("skipped", String(gp.gamepassId || gamepassId), "Без изменений");
            continue;
          }

          if (existing) {
            await prisma.partnerBuyoutTask.update({ where: { id: existing.id }, data });
            result.updated += 1;
            if (existingRevivableCancelled) reconciliation.revived += 1;
            rowItem("updated", String(gp.gamepassId || gamepassId), message);
          } else {
            await prisma.partnerBuyoutTask.create({ data });
            result.created += 1;
            rowItem("created", String(gp.gamepassId || gamepassId), message);
          }
          if (!rowOk) {
            result.failed += 1;
            writeBacks.push(...errorWriteBack);
          }
        } catch (err) {
          const message = truncateGoogleMessage(err instanceof Error ? err.message : "Ошибка проверки геймпасса");
          // BuyoutError = постоянная проблема строки (невалидный/несуществующий ГП) — чип
          // «ошибка». Прочее (сеть, Roblox API) — временное: D оставляем «в ожидании»,
          // чтобы строка попала в следующий sync.
          const permanentRowError = err instanceof BuyoutError;
          const data = {
            partnerId: partner.id,
            externalSource: "GOOGLE_SHEETS" as const,
            externalRowId,
            status: "FAILED" as const,
            robloxUsername: String(cells[SHEET_COL.nickname] ?? "").trim() || null,
            gamepassId,
            gamepassUrl: `https://www.roblox.com/game-pass/${gamepassId}`,
            priceRobux: Math.round(sheetPrice),
            error: message,
            sheetRaw: buildGoogleSheetRaw({
              spreadsheetId,
              sheetTitle: sheet.title,
              sheetId: sheet.sheetId,
              rowNumber,
              cells,
              syncedBy: user ? operatorLabel(user) : null,
              sheetPriceRobux: Math.round(sheetPrice),
            }),
          };
          if (existing) {
            await prisma.partnerBuyoutTask.update({ where: { id: existing.id }, data });
            result.updated += 1;
            if (existingRevivableCancelled) reconciliation.revived += 1;
            rowItem("updated", gamepassId, message);
          } else {
            await prisma.partnerBuyoutTask.create({ data });
            result.created += 1;
            rowItem("created", gamepassId, message);
          }
          result.failed += 1;
          if (permanentRowError) {
            writeBacks.push({ range: googleCellRange(sheet.title, SHEET_STATUS_LETTER, rowNumber), values: [[GOOGLE_STATUS_ERROR]] });
          }
          writeBacks.push({ range: googleCellRange(sheet.title, SHEET_COMMENT_LETTER, rowNumber), values: [[message]] });
        }
      }
    }

    // Реконсиляция удалённых строк (правило владельца 2026-07-10, П10):
    // - активная задача (не выкуплена) — удаляется из TWA полностью («нигде не отмечать»);
    // - DONE (выкуплена/закрыта) — остаётся с деньгами, получает бейдж «удалена из таблицы»;
    // - CANCELLED без денег — тоже удаляется полностью (не выкуплена).
    // Срабатывает только при полном скане; если исчез целый лист (удалён/скрыт/переименован),
    // задачи не трогаем, а активным помечаем конфликт для ручной проверки.
    if (scanComplete) {
      for (const task of existingTasks) {
        if (!task.externalRowId || seenRowIds.has(task.externalRowId)) continue;
        const meta = getGoogleTaskMeta(task);
        if (!meta || meta.spreadsheetId !== spreadsheetId) continue;

        if (!(ACTIVE_TASK_STATUSES as readonly string[]).includes(task.status)) {
          if (!scannedSheetTitles.has(meta.sheetTitle)) continue;
          if (task.status === "DONE") {
            // Деньги/статус не трогаем: заказ выполнен, списание остаётся. Только бейдж.
            if (isRecord(task.sheetRaw) && task.sheetRaw.rowDeletedFromSheet === true) continue;
            await prisma.partnerBuyoutTask.update({
              where: { id: task.id },
              data: { sheetRaw: mergeTaskSheetRaw(task, { rowDeletedFromSheet: true, rowDeletedAt: new Date().toISOString() }) },
            });
            reconciliation.doneMarkedDeleted += 1;
            result.updated += 1;
            result.items.push({
              sheet: meta.sheetTitle,
              row: meta.rowNumber,
              gamepassId: task.gamepassId,
              status: "updated",
              message: "Строка удалена из таблицы — помечена в истории, списание сохранено",
            });
          } else if (task.status === "CANCELLED") {
            // Не выкуплена и строки больше нет — из TWA убираем полностью (guard: деньги).
            const ledgerCount = await prisma.partnerLedgerEntry.count({ where: { taskId: task.id } });
            if (ledgerCount > 0) continue;
            await prisma.partnerBuyoutTask.delete({ where: { id: task.id } });
            reconciliation.deletedFromSheet += 1;
            result.updated += 1;
            result.items.push({
              sheet: meta.sheetTitle,
              row: meta.rowNumber,
              gamepassId: task.gamepassId,
              status: "updated",
              message: "Удалена из TWA: отменённая задача, строка удалена из таблицы",
            });
          }
          continue;
        }

        if (!scannedSheetTitles.has(meta.sheetTitle)) {
          const conflict = `Лист «${meta.sheetTitle}» не найден в таблице — проверь задачу вручную`;
          if ((isRecord(task.sheetRaw) ? task.sheetRaw.conflict : null) !== conflict) {
            await prisma.partnerBuyoutTask.update({
              where: { id: task.id },
              data: { sheetRaw: mergeTaskSheetRaw(task, { conflict, conflictAt: new Date().toISOString() }) },
            });
          }
          reconciliation.conflicts += 1;
          result.skipped += 1;
          result.items.push({ sheet: meta.sheetTitle, row: meta.rowNumber, gamepassId: task.gamepassId, status: "skipped", message: conflict });
          continue;
        }

        const outcome = await deletePartnerTaskForRemovedRow(task, reconciliation, "Строка удалена из таблицы");
        result.updated += 1;
        result.items.push({
          sheet: meta.sheetTitle,
          row: meta.rowNumber,
          gamepassId: task.gamepassId,
          status: "updated",
          message: outcome === "deleted"
            ? "Удалена из TWA: строка удалена из таблицы"
            : "Отменена: строка удалена, но по задаче есть ledger-записи",
        });
      }
    }

    try {
      await batchUpdateGoogleSheetValues(spreadsheetId, writeBacks);
    } catch (err) {
      result.status = "partial";
      result.error = err instanceof Error ? err.message : "Ошибка write-back в Google Sheets";
    }

    if (result.status !== "partial") result.status = result.failed > 0 ? "partial" : "success";
    await prisma.partnerImportRun.update({
      where: { id: run.id },
      data: {
        status: result.status === "success" ? "SUCCESS" : "PARTIAL",
        sheetCount: result.sheetCount,
        rowCount: result.rowCount,
        createdCount: result.created,
        updatedCount: result.updated,
        failedCount: result.failed,
        skippedCount: result.skipped,
        diagnostics: toJsonObject(result.diagnostics),
        error: result.error || null,
        finishedAt: new Date(),
      },
    });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Ошибка sync Google Sheets";
    await prisma.partnerImportRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        sheetCount: result.sheetCount,
        rowCount: result.rowCount,
        createdCount: result.created,
        updatedCount: result.updated,
        failedCount: result.failed,
        skippedCount: result.skipped,
        diagnostics: toJsonObject(result.diagnostics),
        error,
        finishedAt: new Date(),
      },
    });
    return { ...result, status: "failed" as const, error };
  }
}

/**
 * Быстрая проверка «нужен ли фоновый sync» для GET: тот же TTL/RUNNING-гейт, что и внутри
 * syncPartnerGoogleSheets (он перепроверит ещё раз перед стартом). Возвращает true и когда
 * sync уже идёт — клиенту в обоих случаях стоит перечитать состояние через несколько секунд.
 */
async function shouldScheduleGoogleSync(partner: Partner) {
  if (!partner.googleSheetId?.trim() || !isGoogleSheetsConfigured()) return false;

  const latestRun = await prisma.partnerImportRun.findFirst({
    where: { partnerId: partner.id, source: "GOOGLE_SHEETS" },
    orderBy: { startedAt: "desc" },
    select: { status: true, startedAt: true, finishedAt: true },
  });
  if (!latestRun) return true;
  if (latestRun.finishedAt && Date.now() - latestRun.finishedAt.getTime() < GOOGLE_SYNC_TTL_MS) return false;
  return true;
}

async function requireTwaUser(req: NextRequest) {
  const user = await extractTwaUser(req);
  if (!user) throw new BuyoutError("Unauthorized", 401);
  return user;
}

async function getPartner(slug: string) {
  const name = PARTNER_NAME_BY_SLUG[slug];
  if (!name) return null;

  const antonSheetConfig = slug === "anton" ? getAntonGoogleSheetConfig() : {};

  return prisma.partner.upsert({
    where: { slug },
    update: slug === "anton" ? {
      ledgerCurrency: DEFAULT_PARTNER_CURRENCY,
      ...antonSheetConfig,
    } : {},
    create: {
      slug,
      name,
      ledgerCurrency: DEFAULT_PARTNER_CURRENCY,
      robuxRateUsdtPer1000: DEFAULT_ANTON_RATE_USDT_PER_1000_R,
      ...antonSheetConfig,
    },
  });
}

async function loadPartnerState(partner: Partner) {
  const currency = moneyCurrency(partner);
  const [tasks, ledgerEntries, importRuns, balanceAgg, spentAgg] = await Promise.all([
    prisma.partnerBuyoutTask.findMany({
      where: { partnerId: partner.id },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    }),
    prisma.partnerLedgerEntry.findMany({
      where: { partnerId: partner.id, currency },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
    prisma.partnerImportRun.findMany({
      where: { partnerId: partner.id, source: "GOOGLE_SHEETS" },
      orderBy: [{ startedAt: "desc" }],
      take: 5,
    }),
    prisma.partnerLedgerEntry.aggregate({
      where: { partnerId: partner.id, currency },
      _sum: { amount: true },
    }),
    prisma.partnerLedgerEntry.aggregate({
      where: { partnerId: partner.id, currency, type: "BUYOUT" },
      _sum: { amount: true },
    }),
  ]);

  const balanceUsdt = balanceAgg._sum.amount ?? 0;
  const spentUsdt = Math.abs(spentAgg._sum.amount ?? 0);
  // Закрытые вручную из таблицы (closedFromSheet) не попадают в «Выкуплено»:
  // по ним не было ни покупки, ни списания USDT.
  const doneRobux = tasks
    .filter((task) => task.status === "DONE" && !(isRecord(task.sheetRaw) && task.sheetRaw.closedFromSheet === true))
    .reduce((sum, task) => sum + getTaskPrice(task), 0);
  const reservedUsdt = tasks
    .filter((task) => task.status === "READY" || task.status === "PURCHASING")
    .reduce((sum, task) => sum + taskCostUsdt(getTaskPrice(task), partner), 0);
  // Расхождение цены с 2026-07-10 переводит задачу в FAILED, поэтому FAILED тоже считаем.
  const mismatches = tasks
    .filter((task) => task.status !== "DONE" && task.status !== "CANCELLED"
      && isRecord(task.sheetRaw) && task.sheetRaw.priceMismatch === true)
    .length;
  const conflicts = tasks
    .filter((task) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(task.status)
      && isRecord(task.sheetRaw) && Boolean(task.sheetRaw.conflict))
    .length;

  return {
    tasks,
    ledgerEntries,
    importRuns,
    googleSync: {
      configured: Boolean(partner.googleSheetId),
      serviceAccountConfigured: isGoogleSheetsConfigured(),
      lastSyncAt: importRuns[0]?.finishedAt ?? importRuns[0]?.startedAt ?? null,
      latestRun: importRuns[0] ?? null,
    },
    summary: {
      balanceUsdt,
      spentUsdt,
      doneRobux,
      reservedUsdt,
      ledgerCurrency: currency,
      robuxRateUsdtPer1000: partner.robuxRateUsdtPer1000,
      total: tasks.length,
      ready: tasks.filter((task) => task.status === "READY").length,
      purchasing: tasks.filter((task) => task.status === "PURCHASING").length,
      done: tasks.filter((task) => task.status === "DONE").length,
      failed: tasks.filter((task) => task.status === "FAILED").length,
      mismatches,
      conflicts,
    },
  };
}

async function getPartnerBalance(partner: Partner) {
  const aggregate = await prisma.partnerLedgerEntry.aggregate({
    where: { partnerId: partner.id, currency: moneyCurrency(partner) },
    _sum: { amount: true },
  });
  return aggregate._sum.amount ?? 0;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await requireTwaUser(req);
    const { slug } = await ctx.params;
    const partner = await getPartner(slug);
    if (!partner) return json({ ok: false, error: "Партнёр не найден" }, 404);

    // Opportunistic sync больше не блокирует GET: скан листов + resolve геймпассов занимал
    // десятки секунд, и экран «Антон» висел на «Загружаю…». Отдаём состояние из БД сразу,
    // sync уходит в фон (after), клиент подтянет результат silent-refresh'ем.
    const syncScheduled = await shouldScheduleGoogleSync(partner);
    if (syncScheduled) {
      after(async () => {
        try {
          await syncPartnerGoogleSheets(partner, null, { force: false });
        } catch (err) {
          console.error("[partners/tasks GET background sync]", err);
        }
      });
    }
    const state = await loadPartnerState(partner);
    return json({ ok: true, partner, syncScheduled, ...state });
  } catch (err) {
    if (err instanceof BuyoutError) return json({ ok: false, error: err.message }, err.status);
    if (isPartnerSchemaNotReadyError(err)) {
      console.error("[partners/tasks GET schema]", err);
      return partnerSchemaNotReadyResponse();
    }
    console.error("[partners/tasks GET]", err);
    return json({ ok: false, error: "Ошибка загрузки партнёрских задач" }, 500);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const user = await requireTwaUser(req);
    const { slug } = await ctx.params;
    const partner = await getPartner(slug);
    if (!partner) return json({ ok: false, error: "Партнёр не найден" }, 404);

    const { body, file } = await readPartnerPostBody(req);
    const action = String(body.action || "");

    if (action === "import-xlsx") {
      const importResult = await importPartnerXlsx(partner, user, file);
      const state = await loadPartnerState(partner);
      return json({ ok: true, partner, importResult, ...state });
    }

    if (action === "sync-google-sheets") {
      const syncResult = await syncPartnerGoogleSheets(partner, user, { force: true });
      const state = await loadPartnerState(partner);
      return json({ ok: true, partner, syncResult, ...state });
    }

    if (action === "create-task") {
      const rawGamepass = String(body.gamepass || body.gamepassUrl || body.gamepassId || "").trim();
      if (!rawGamepass) return json({ ok: false, error: "Укажите ID или URL геймпасса" }, 400);

      const gp = await resolveGamepass(rawGamepass);
      if (!gp.isForSale) return json({ ok: false, error: "Геймпасс не продаётся" }, 409);
      if (!gp.price || gp.price <= 0 || !gp.productId || !gp.sellerId) {
        return json({ ok: false, error: "У геймпасса нет цены или productId" }, 409);
      }

      const duplicate = await prisma.partnerBuyoutTask.findFirst({
        where: {
          partnerId: partner.id,
          gamepassId: String(gp.gamepassId),
          status: { notIn: ["DONE", "CANCELLED"] },
        },
      });
      if (duplicate) return json({ ok: false, error: "Этот геймпасс уже есть в активных задачах Антона" }, 409);

      await prisma.partnerBuyoutTask.create({
        data: {
          partnerId: partner.id,
          externalSource: "MANUAL",
          status: "READY",
          robloxUsername: String(body.robloxUsername || "").trim() || null,
          gamepassId: String(gp.gamepassId),
          gamepassUrl: `https://www.roblox.com/game-pass/${gp.gamepassId}`,
          productId: String(gp.productId),
          sellerId: String(gp.sellerId),
          sellerName: gp.sellerName || null,
          priceRobux: gp.price,
          note: String(body.note || "").trim() || null,
          sheetRaw: { source: "twa-manual", input: rawGamepass },
        },
      });

      const state = await loadPartnerState(partner);
      return json({ ok: true, partner, ...state });
    }

    if (action === "ledger-topup") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return json({ ok: false, error: "Сумма пополнения должна быть больше 0" }, 400);
      }

      await prisma.partnerLedgerEntry.create({
        data: {
          partnerId: partner.id,
          type: "TOPUP",
          amount,
          currency: moneyCurrency(partner),
          comment: String(body.comment || "").trim() || "Пополнение баланса партнёра в USDT",
          createdBy: operatorLabel(user),
        },
      });

      const state = await loadPartnerState(partner);
      return json({ ok: true, partner, ...state });
    }

    if (action === "set-rate") {
      const rate = Number(body.robuxRateUsdtPer1000);
      if (!Number.isFinite(rate) || rate <= 0) {
        return json({ ok: false, error: "Курс должен быть больше 0" }, 400);
      }
      if (rate > 1000) {
        return json({ ok: false, error: "Слишком большой курс" }, 400);
      }

      const updatedPartner = await prisma.partner.update({
        where: { id: partner.id },
        data: { robuxRateUsdtPer1000: Math.round(rate * 10000) / 10000 },
      });

      const state = await loadPartnerState(updatedPartner);
      return json({ ok: true, partner: updatedPartner, ...state });
    }

    if (action === "cancel-task") {
      const taskId = String(body.taskId || "");
      if (!taskId) return json({ ok: false, error: "taskId обязателен" }, 400);

      const cancelled = await prisma.partnerBuyoutTask.updateMany({
        where: { id: taskId, partnerId: partner.id, status: { notIn: ["DONE", "CANCELLED", "PURCHASING"] } },
        data: { status: "CANCELLED", error: null, note: "Отменена менеджером из TWA" },
      });
      if (cancelled.count !== 1) return json({ ok: false, error: "Задача уже обрабатывается или завершена" }, 409);

      // Отмена должна быть видна Антону: D=«ошибка» + «Отменено менеджером» в E.
      // cancelledByManager отличает её от отмен реконсиляции; вернуть задачу в работу
      // Антон может, выставив D обратно в «в ожидании» (после успешного write-back).
      const task = await prisma.partnerBuyoutTask.findUnique({ where: { id: taskId } });
      if (task) {
        const markedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { sheetRaw: mergeTaskSheetRaw(task, { cancelledByManager: true, cancelledAt: new Date().toISOString() }) },
        });
        await writeBackPartnerTask(markedTask, "cancelled");
      }

      const state = await loadPartnerState(partner);
      return json({ ok: true, partner, ...state });
    }

    if (action === "mark-done") {
      const taskId = String(body.taskId || "");
      if (!taskId) return json({ ok: false, error: "taskId обязателен" }, 400);

      const task = await prisma.partnerBuyoutTask.findFirst({
        where: { id: taskId, partnerId: partner.id },
      });
      if (!task) return json({ ok: false, error: "Задача не найдена" }, 404);
      if (task.status === "DONE" || task.status === "CANCELLED") {
        return json({ ok: false, error: "Задача уже закрыта" }, 409);
      }

      const existingBuyout = await prisma.partnerLedgerEntry.findFirst({
        where: { partnerId: partner.id, taskId: task.id, type: "BUYOUT" },
      });
      if (existingBuyout) return json({ ok: false, error: "По задаче уже есть списание" }, 409);

      const manualPrice =
        body.purchasePriceRobux === undefined || body.purchasePriceRobux === null || body.purchasePriceRobux === ""
          ? null
          : Number(body.purchasePriceRobux);
      if (manualPrice !== null && (!Number.isFinite(manualPrice) || manualPrice <= 0)) {
        return json({ ok: false, error: "Фактическая цена должна быть больше 0" }, 400);
      }

      const priceRobux = manualPrice ?? getTaskPrice(task);
      const priceUsdt = priceRobux > 0 ? taskCostUsdt(priceRobux, partner) : 0;
      if (priceUsdt > 0) {
        const balance = await getPartnerBalance(partner);
        if (balance < priceUsdt) {
          return json({ ok: false, error: "Недостаточно баланса партнёра" }, 409);
        }
      }

      const updatedTask = await prisma.partnerBuyoutTask.update({
        where: { id: task.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          purchaseAccountName: String(body.purchaseAccountName || "").trim() || null,
          purchasePriceRobux: manualPrice ?? undefined,
          error: null,
        },
      });

      if (priceUsdt > 0) {
        await prisma.partnerLedgerEntry.create({
          data: {
            partnerId: partner.id,
            taskId: updatedTask.id,
            type: "BUYOUT",
            amount: -priceUsdt,
            currency: moneyCurrency(partner),
            reference: updatedTask.gamepassId,
            comment: `Ручная отметка партнёрского выкупа: ${priceRobux} R$ × ${partner.robuxRateUsdtPer1000} USDT / 1000 R$`,
            createdBy: operatorLabel(user),
          },
        });
      }

      await writeBackPartnerTask(updatedTask, "done");
      const state = await loadPartnerState(partner);
      return json({ ok: true, partner, ...state });
    }

    if (action === "purchase-task") {
      const taskId = String(body.taskId || "");
      if (!taskId) return json({ ok: false, error: "taskId обязателен" }, 400);

      const claimed = await prisma.partnerBuyoutTask.updateMany({
        where: { id: taskId, partnerId: partner.id, status: { in: ["READY", "FAILED"] } },
        data: { status: "PURCHASING", error: null },
      });
      if (claimed.count !== 1) return json({ ok: false, error: "Задача уже обрабатывается или завершена" }, 409);

      const [task, settings] = await Promise.all([
        prisma.partnerBuyoutTask.findUnique({ where: { id: taskId } }),
        prisma.globalSettings.findUnique({ where: { id: "global" } }),
      ]);

      if (!task || task.partnerId !== partner.id) return json({ ok: false, error: "Задача не найдена" }, 404);
      if (!settings?.robloxCookie) {
        // Внутренняя ошибка операций — в таблицу Антона не пишем вообще.
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "FAILED", error: "Roblox cookie не задан" },
        });
        return json({ ok: false, error: "Roblox cookie не задан" }, 409);
      }

      const price = task.priceRobux ?? 0;
      const productId = Number(task.productId);
      const sellerId = Number(task.sellerId);
      if (!price || !productId || !sellerId) {
        const failedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "FAILED", error: "В задаче нет цены/productId/sellerId" },
        });
        await writeBackPartnerTask(failedTask, "error", "В задаче нет цены/productId/sellerId");
        return json({ ok: false, error: "В задаче нет цены/productId/sellerId" }, 409);
      }

      const priceUsdt = taskCostUsdt(price, partner);
      const balanceBeforePurchase = await getPartnerBalance(partner);
      if (balanceBeforePurchase < priceUsdt) {
        // Не ошибка строки: чип «ошибка» не ставим, но Антону в «комментарий» пишем —
        // нехватка его баланса решается пополнением.
        const failedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "READY", error: "Недостаточно баланса партнёра" },
        });
        await writeBackPartnerTask(failedTask, "comment", "Недостаточно баланса партнёра");
        return json({ ok: false, error: "Недостаточно баланса партнёра", partner, ...(await loadPartnerState(partner)) }, 409);
      }

      const result = await purchaseGamepassWithCookie(settings.robloxCookie, { productId, price, sellerId });
      if (!result.success) {
        const failedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "FAILED", error: result.msg },
        });
        // Протухший cookie и нехватка Robux на доноре — наши проблемы, не Антона:
        // строку красным не помечаем, чтобы она осталась «в ожидании» для ретрая.
        const internalFailure = /cookie|insufficient.?funds|недостаточно/i.test(result.msg || "");
        await writeBackPartnerTask(failedTask, internalFailure ? "comment" : "error", result.msg);
        return json({ ok: true, success: false, error: result.msg, balance: result.balance, partner, ...(await loadPartnerState(partner)) });
      }

      const doneTask = await prisma.partnerBuyoutTask.update({
        where: { id: task.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          purchaseAccountName: settings.robloxAccountName || null,
          purchasePriceRobux: price,
          error: null,
        },
      });
      await writeBackPartnerTask(doneTask, "done");

      const existingBuyout = await prisma.partnerLedgerEntry.findFirst({
        where: { partnerId: partner.id, taskId: task.id, type: "BUYOUT" },
      });
      if (!existingBuyout) {
        await prisma.partnerLedgerEntry.create({
          data: {
            partnerId: partner.id,
            taskId: task.id,
            type: "BUYOUT",
            amount: -priceUsdt,
            currency: moneyCurrency(partner),
            reference: task.gamepassId,
            comment: `Партнёрский выкуп через ${settings.robloxAccountName || "cookie-аккаунт"}: ${price} R$ × ${partner.robuxRateUsdtPer1000} USDT / 1000 R$`,
            createdBy: operatorLabel(user),
          },
        });
      }

      const state = await loadPartnerState(partner);
      return json({ ok: true, success: true, balance: result.balance, partner, ...state });
    }

    return json({ ok: false, error: "Неизвестное действие" }, 400);
  } catch (err) {
    if (err instanceof BuyoutError) return json({ ok: false, error: err.message }, err.status);
    if (isPartnerSchemaNotReadyError(err)) {
      console.error("[partners/tasks POST schema]", err);
      return partnerSchemaNotReadyResponse();
    }
    console.error("[partners/tasks POST]", err);
    return json({ ok: false, error: "Ошибка партнёрского действия" }, 500);
  }
}
