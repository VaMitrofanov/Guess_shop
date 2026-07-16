import { createHash, randomUUID } from "crypto";

import { after, NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { Prisma, type Partner, type PartnerBuyoutTask } from "@prisma/client";

import {
  batchUpdateGoogleSheetStructural,
  batchGetGoogleSheetValues,
  batchUpdateGoogleSheetValues,
  buildAddProtectedRangeRequest,
  buildDeleteProtectedRangeRequest,
  buildUpdateCellRequest,
  getGoogleProtectionEditors,
  googleCellRange,
  isGoogleSheetsConfigured,
  listGoogleSheetProtectedRanges,
  listGoogleSheets,
  quoteGoogleSheetTitle,
  type GoogleProtectedRangeInfo,
  type GoogleSheetsRequest,
  type GoogleSheetsValueUpdate,
} from "@/lib/google-sheets";
import { BuyoutError, parseGamepassId, purchaseGamepassWithCookie, resolveGamepass, resolveGamepassForBuyer, type PurchaseResult } from "@/lib/roblox-buyout";
import { notifyPartnerBuyout, type PartnerBuyoutNotifyItem } from "@/lib/partner-buyout-notify";
import { partnerGamepassCommentValue, settledPartnerRowPolicy } from "@/lib/partner-sheet-policy";
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
// 5.8: выполненные строки лочатся addProtectedRange — в таблице работает Apps Script
// против ручной смены статусов, но API-записи он не видит, поэтому защиту ставит бот.
// Диапазон A:D (E остаётся каналом комментариев); редакторы — владелец таблицы
// (env GOOGLE_SHEETS_PROTECTED_EDITORS) + сервисный аккаунт (client_email credentials).
const SHEET_PROTECTION_DESCRIPTION_PREFIX = "Заблокировано ботом";
const SHEET_PENDING_PROTECTION_DESCRIPTION_PREFIX = "Статус заблокирован ботом";
const SHEET_PROTECTION_END_COLUMN = SHEET_COL.status + 1;

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
  /** 5.7 B1: строки «готово» без задачи, импортированные как выкупленные со списанием. */
  importedDone: number;
  /** 5.7 B2: строки, переиспользованные под новый заказ (старая DONE-задача в архиве). */
  rowsReused: number;
  /** 5.7 C1: исправленные строки-ошибки, возвращённые в READY + чип «в ожидании». */
  reactivated: number;
  /** 5.7 C2: правки строк «готово» после выкупа (задача не мутирует, только пометка). */
  editedAfterDone: number;
};

/** 5.8: итоги установки/снятия защит строк за прогон. */
type GoogleSyncProtectionStats = {
  /** Новые защиты, поставленные этим прогоном. */
  locked: number;
  /** Защита уже стояла в таблице, задаче дописан потерянный protectedRangeId. */
  healed: number;
  /** Снятые защиты (переиспользование строки, B2-архив). */
  unlocked: number;
  /** Задачи, для которых установка защиты не удалась (дочинит следующий sync). */
  failed: number;
  /** 5.11: новые точечные D-локи у активных pending-строк. */
  pendingLocked: number;
  /** 5.11: D-локи, снятые при DONE/FAILED/CANCELLED. */
  pendingUnlocked: number;
};

type GoogleSyncDiagnostics = GoogleSyncFilterStats & {
  sheets: GoogleSyncSheetDiagnostics[];
  reconciliation?: GoogleSyncReconciliationStats;
  protection?: GoogleSyncProtectionStats;
};

/** 5.8: отложенные операции защиты строк, применяются одним батчем в конце прогона. */
type PartnerProtectionOp =
  | { kind: "protect"; taskId: string; sheetId: number; rowNumber: number }
  | { kind: "protect-pending"; taskId: string; sheetId: number; rowNumber: number }
  | { kind: "unprotect"; protectedRangeId: number; taskId?: string; clearField?: "protectedRangeId" | "pendingProtectedRangeId" };

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

// Содержимое заказа = A:C (ник, ГП, номинал). D/E — статус и комментарий, их меняем и мы,
// и Антон; для проверок «эта ли строка выкуплена» (B2) и «строку исправили» (C1) они не в счёт.
const SHEET_CONTENT_CELLS = [SHEET_COL.nickname, SHEET_COL.gamepass, SHEET_COL.amount] as const;

function normalizeContentCells(cells: unknown[]) {
  return SHEET_CONTENT_CELLS.map((i) => String(cells[i] ?? "").trim());
}

function computeGoogleRowContentHash(cells: unknown[]) {
  return createHash("sha1").update(JSON.stringify(normalizeContentCells(cells))).digest("hex").slice(0, 16);
}

function getStoredContentHash(task: Pick<PartnerBuyoutTask, "sheetRaw">) {
  if (!isRecord(task.sheetRaw)) return null;
  if (typeof task.sheetRaw.contentHash === "string" && task.sheetRaw.contentHash) return task.sheetRaw.contentHash;
  if (Array.isArray(task.sheetRaw.cells)) return computeGoogleRowContentHash(task.sheetRaw.cells);
  return null;
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
    contentHash: computeGoogleRowContentHash(input.cells),
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

function getTaskProtectedRangeId(task: Pick<PartnerBuyoutTask, "sheetRaw">) {
  if (!isRecord(task.sheetRaw)) return null;
  const id = task.sheetRaw.protectedRangeId;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

function getTaskPendingProtectedRangeId(task: Pick<PartnerBuyoutTask, "sheetRaw">) {
  if (!isRecord(task.sheetRaw)) return null;
  const id = task.sheetRaw.pendingProtectedRangeId;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
}

function buildPartnerRowProtectRequest(sheetId: number, rowNumber: number) {
  return buildAddProtectedRangeRequest({
    sheetId,
    rowNumber,
    startColumnIndex: SHEET_COL.nickname,
    endColumnIndex: SHEET_PROTECTION_END_COLUMN,
    description: `${SHEET_PROTECTION_DESCRIPTION_PREFIX} (строка ${rowNumber})`,
    editors: getGoogleProtectionEditors(),
  });
}

function buildPartnerPendingProtectRequest(sheetId: number, rowNumber: number) {
  return buildAddProtectedRangeRequest({
    sheetId,
    rowNumber,
    startColumnIndex: SHEET_COL.status,
    endColumnIndex: SHEET_COL.status + 1,
    description: `${SHEET_PENDING_PROTECTION_DESCRIPTION_PREFIX} (строка ${rowNumber})`,
    editors: getGoogleProtectionEditors(),
  });
}

function findBotRowProtection(protections: GoogleProtectedRangeInfo[], sheetId: number, rowNumber: number) {
  return protections.find((protection) => protection.range.sheetId === sheetId
    && protection.range.startRowIndex === rowNumber - 1
    && protection.range.endRowIndex === rowNumber
    && protection.description.startsWith(SHEET_PROTECTION_DESCRIPTION_PREFIX)) ?? null;
}

function findBotPendingProtection(protections: GoogleProtectedRangeInfo[], sheetId: number, rowNumber: number) {
  return protections.find((protection) => protection.range.sheetId === sheetId
    && protection.range.startRowIndex === rowNumber - 1
    && protection.range.endRowIndex === rowNumber
    && protection.description.startsWith(SHEET_PENDING_PROTECTION_DESCRIPTION_PREFIX)) ?? null;
}

/**
 * Патч sheetRaw по свежей версии задачи из БД: между постановкой отложенной операции
 * и её применением задача могла обновиться другим кодом прогона.
 */
async function patchTaskSheetRaw(taskId: string, patch: Record<string, unknown>) {
  const task = await prisma.partnerBuyoutTask.findUnique({ where: { id: taskId } });
  if (!task) return;
  await prisma.partnerBuyoutTask.update({
    where: { id: taskId },
    data: { sheetRaw: mergeTaskSheetRaw(task, patch) },
  });
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
    // Единый дедуп ГП для ручных путей (№6 ультра-ревью, как в create-task): блокируют
    // только активные задачи — повторный выкуп того же ГП после DONE легитимен (в боевой
    // таблице заказы полностью повторяются). Google дедупится по строке by design.
    const duplicate = await prisma.partnerBuyoutTask.findFirst({
      where: {
        partnerId: partner.id,
        OR: [
          {
            gamepassId: row.gamepassId,
            status: { notIn: ["DONE", "CANCELLED"] },
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

      // №11 ультра-ревью: created — только реально готовые задачи; созданная сразу
      // FAILED идёт в failed, чтобы «+N» в тосте не выглядел успехом.
      if (ready) {
        result.created += 1;
        result.items.push({
          row: row.rowNumber,
          gamepassId: row.gamepassId,
          status: "created",
          message: "Готова к выкупу",
        });
      } else {
        result.failed += 1;
        result.items.push({
          row: row.rowNumber,
          gamepassId: row.gamepassId,
          status: "failed",
          message: "Создана с ошибкой проверки",
        });
      }
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

      result.failed += 1;
      result.items.push({
        row: row.rowNumber,
        gamepassId: row.gamepassId,
        status: "failed",
        message: `Создана с ошибкой: ${message}`,
      });
    }
  }

  return result;
}

/**
 * kind="done"      -> 5.8: одним атомарным spreadsheets.batchUpdate — D="готово",
 *                     E очищается и на A:D строки ставится addProtectedRange (в таблице
 *                     Apps Script запрещает сотрудникам менять статусы, но API-записи
 *                     он не видит — защиту выполненной строки ставит сам бот).
 * kind="error"     -> D="ошибка" (красная строка у Антона) + причина в E («комментарий»).
 *                     Строка выходит из фильтра «в ожидании» до ручного исправления.
 *                     Защита НЕ ставится: сотрудники могут вернуть «в ожидании».
 * kind="comment"   -> только E; D не трогаем (внутренние ошибки операций: cookie,
 *                     баланс партнёра — строка должна остаться «в ожидании»).
 * kind="cancelled" -> D="ошибка" + E="Отменено менеджером": отмена из TWA должна быть
 *                     видна Антону. Успешная запись ставит cancelWriteBackAt — только
 *                     после неё возврат D в «в ожидании» реанимирует задачу.
 */
async function writeBackPartnerTask(task: PartnerBuyoutTask, kind: "done" | "error" | "comment" | "cancelled", message?: string) {
  const meta = getGoogleTaskMeta(task);
  if (!meta || !isGoogleSheetsConfigured()) return;

  if (kind === "done") {
    await writeBackPartnerTaskDone(task, meta);
    return;
  }

  const errorMessage = truncateGoogleMessage(
    message || (kind === "cancelled" ? GOOGLE_CANCELLED_COMMENT : task.error) || "Ошибка обработки",
  );
  const updates: GoogleSheetsValueUpdate[] = kind === "error" || kind === "cancelled"
    ? [
      { range: googleCellRange(meta.sheetTitle, SHEET_STATUS_LETTER, meta.rowNumber), values: [[GOOGLE_STATUS_ERROR]] },
      { range: googleCellRange(meta.sheetTitle, SHEET_COMMENT_LETTER, meta.rowNumber), values: [[errorMessage]] },
    ]
    : [
      { range: googleCellRange(meta.sheetTitle, SHEET_COMMENT_LETTER, meta.rowNumber), values: [[errorMessage]] },
    ];

  try {
    await batchUpdateGoogleSheetValues(meta.spreadsheetId, updates);
    await patchTaskSheetRaw(task.id, {
      writeBackAt: new Date().toISOString(),
      lastWriteBackError: null,
      ...(kind === "cancelled" ? { cancelWriteBackAt: new Date().toISOString() } : {}),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Ошибка записи в Google Sheets";
    await patchTaskSheetRaw(task.id, {
      lastWriteBackError: error,
      lastWriteBackFailedAt: new Date().toISOString(),
    });
  }
}

/**
 * 5.8: успешное «готово». Повторный вызов защиту не дублирует: protectedRangeId хранится
 * в sheetRaw, а при его отсутствии существующая защита ищется в таблице по диапазону и
 * описанию (страховка после чисток БД, когда знание об id потеряно). Если sheetId листа
 * неизвестен и не резолвится — значения пишутся старым values-путём, защиту дочинит
 * ближайший sync (DONE-ветка «инвариант DONE = залочено»).
 */
async function writeBackPartnerTaskDone(task: PartnerBuyoutTask, meta: NonNullable<ReturnType<typeof getGoogleTaskMeta>>) {
  try {
    let sheetId = typeof meta.raw.sheetId === "number" ? meta.raw.sheetId : null;
    if (sheetId === null) {
      const sheet = (await listGoogleSheets(meta.spreadsheetId)).find((info) => info.title === meta.sheetTitle);
      sheetId = sheet?.sheetId ?? null;
    }
    if (sheetId === null) {
      await batchUpdateGoogleSheetValues(meta.spreadsheetId, [
        { range: googleCellRange(meta.sheetTitle, SHEET_STATUS_LETTER, meta.rowNumber), values: [[GOOGLE_STATUS_DONE]] },
        { range: googleCellRange(meta.sheetTitle, SHEET_COMMENT_LETTER, meta.rowNumber), values: [[""]] },
      ]);
      await patchTaskSheetRaw(task.id, {
        writeBackAt: new Date().toISOString(),
        lastWriteBackError: null,
        protectError: "sheetId листа не найден — защита строки будет установлена sync'ом",
      });
      return;
    }

    let protectedRangeId = getTaskProtectedRangeId(task);
    if (protectedRangeId === null) {
      const existing = findBotRowProtection(
        await listGoogleSheetProtectedRanges(meta.spreadsheetId),
        sheetId,
        meta.rowNumber,
      );
      protectedRangeId = existing?.protectedRangeId ?? null;
    }

    const requests: GoogleSheetsRequest[] = [
      buildUpdateCellRequest({ sheetId, rowNumber: meta.rowNumber, columnIndex: SHEET_COL.status, value: GOOGLE_STATUS_DONE }),
      buildUpdateCellRequest({ sheetId, rowNumber: meta.rowNumber, columnIndex: SHEET_COL.comment, value: "" }),
    ];
    let protectIndex = -1;
    if (protectedRangeId === null) {
      protectIndex = requests.length;
      requests.push(buildPartnerRowProtectRequest(sheetId, meta.rowNumber));
    }
    const { replies } = await batchUpdateGoogleSheetStructural(meta.spreadsheetId, requests);
    if (protectIndex >= 0) {
      const replyId = replies[protectIndex]?.addProtectedRange?.protectedRange?.protectedRangeId;
      if (typeof replyId === "number") protectedRangeId = replyId;
    }
    await patchTaskSheetRaw(task.id, {
      writeBackAt: new Date().toISOString(),
      lastWriteBackError: null,
      protectError: null,
      ...(protectedRangeId !== null ? { protectedRangeId, protectedAt: new Date().toISOString() } : {}),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Ошибка записи в Google Sheets";
    await patchTaskSheetRaw(task.id, {
      lastWriteBackError: error,
      lastWriteBackFailedAt: new Date().toISOString(),
    });
  }
}

/**
 * 5.8: применение отложенных защит строк одним структурным batchUpdate в конце прогона
 * sync. Перед добавлением сверяемся с существующими защитами таблицы: защита без
 * записанного id «лечится» (id дописывается задаче), дубль не создаётся. Ошибка не
 * роняет прогон — инвариант «DONE = залочено» дочинит следующий sync (DONE-ветка).
 */
async function applyPartnerProtectionOps(
  spreadsheetId: string,
  ops: PartnerProtectionOp[],
  stats: GoogleSyncProtectionStats,
): Promise<string | null> {
  if (ops.length === 0) return null;
  const protectOpsCount = ops.filter((op) => op.kind !== "unprotect").length;

  try {
    const protections = await listGoogleSheetProtectedRanges(spreadsheetId);
    const knownIds = new Set(protections.map((protection) => protection.protectedRangeId));
    const requests: GoogleSheetsRequest[] = [];
    const pendingProtects: Array<{ taskId: string; requestIndex: number; kind: "protect" | "protect-pending" }> = [];
    const pendingClears: Array<{ taskId: string; clearField: "protectedRangeId" | "pendingProtectedRangeId" }> = [];
    const seenTargets = new Set<string>();
    let deleteCount = 0;
    let pendingDeleteCount = 0;

    for (const op of ops) {
      if (op.kind === "unprotect") {
        // Снимаем только реально существующую защиту: deleteProtectedRange с чужим id
        // валит весь батч.
        if (knownIds.has(op.protectedRangeId)) {
          requests.push(buildDeleteProtectedRangeRequest(op.protectedRangeId));
          if (op.clearField === "pendingProtectedRangeId") pendingDeleteCount += 1;
          else deleteCount += 1;
        }
        if (op.taskId && op.clearField) pendingClears.push({ taskId: op.taskId, clearField: op.clearField });
        continue;
      }
      const targetKey = `${op.kind}:${op.sheetId}:${op.rowNumber}`;
      if (seenTargets.has(targetKey)) continue;
      seenTargets.add(targetKey);
      const isPending = op.kind === "protect-pending";
      const existing = isPending
        ? findBotPendingProtection(protections, op.sheetId, op.rowNumber)
        : findBotRowProtection(protections, op.sheetId, op.rowNumber);
      if (existing) {
        await patchTaskSheetRaw(op.taskId, {
          [isPending ? "pendingProtectedRangeId" : "protectedRangeId"]: existing.protectedRangeId,
          [isPending ? "pendingProtectedAt" : "protectedAt"]: new Date().toISOString(),
          protectError: null,
        });
        if (!isPending) stats.healed += 1;
        continue;
      }
      pendingProtects.push({ taskId: op.taskId, requestIndex: requests.length, kind: op.kind });
      requests.push(isPending
        ? buildPartnerPendingProtectRequest(op.sheetId, op.rowNumber)
        : buildPartnerRowProtectRequest(op.sheetId, op.rowNumber));
    }
    if (requests.length === 0) {
      for (const clear of pendingClears) {
        await patchTaskSheetRaw(clear.taskId, {
          [clear.clearField]: null,
          ...(clear.clearField === "pendingProtectedRangeId" ? { pendingProtectedAt: null } : { protectedAt: null }),
        });
      }
      return null;
    }

    const { replies } = await batchUpdateGoogleSheetStructural(spreadsheetId, requests);
    stats.unlocked += deleteCount;
    stats.pendingUnlocked += pendingDeleteCount;
    for (const clear of pendingClears) {
      await patchTaskSheetRaw(clear.taskId, {
        [clear.clearField]: null,
        ...(clear.clearField === "pendingProtectedRangeId" ? { pendingProtectedAt: null } : { protectedAt: null }),
      });
    }
    for (const pending of pendingProtects) {
      const replyId = replies[pending.requestIndex]?.addProtectedRange?.protectedRange?.protectedRangeId;
      const isPending = pending.kind === "protect-pending";
      await patchTaskSheetRaw(pending.taskId, {
        ...(typeof replyId === "number" ? { [isPending ? "pendingProtectedRangeId" : "protectedRangeId"]: replyId } : {}),
        [isPending ? "pendingProtectedAt" : "protectedAt"]: new Date().toISOString(),
        protectError: null,
      });
      if (isPending) stats.pendingLocked += 1;
      else stats.locked += 1;
    }
    return null;
  } catch (err) {
    stats.failed += protectOpsCount;
    return err instanceof Error ? err.message : "Ошибка установки защиты строк";
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
 * 5.7 B1: ручное «готово» в таблице = выкупленный заказ, USDT списывается по номиналу C.
 * Баланс может уйти в минус (решение владельца: факт выкупа важнее, предупреждение в TWA).
 * Guard от повторного списания — существующая BUYOUT-запись по задаче.
 */
async function debitPartnerTaskFromSheet(
  partner: Partner,
  task: Pick<PartnerBuyoutTask, "id" | "gamepassId">,
  priceRobux: number,
  user: TwaUser,
  reason: string,
) {
  if (!priceRobux || priceRobux <= 0) return 0;
  const existingBuyout = await prisma.partnerLedgerEntry.findFirst({
    where: { partnerId: partner.id, taskId: task.id, type: "BUYOUT" },
    select: { id: true },
  });
  if (existingBuyout) return 0;

  const priceUsdt = taskCostUsdt(priceRobux, partner);
  if (priceUsdt <= 0) return 0;
  await prisma.partnerLedgerEntry.create({
    data: {
      partnerId: partner.id,
      taskId: task.id,
      type: "BUYOUT",
      amount: -priceUsdt,
      currency: moneyCurrency(partner),
      rateUsdtPer1000: partner.robuxRateUsdtPer1000,
      robuxAmount: priceRobux,
      purchaseAccountName: "Вручную / из таблицы",
      batchId: `sheet:${task.id}`,
      itemCount: 1,
      reference: task.gamepassId,
      comment: `${reason}: ${priceUsdt.toFixed(2)} USDT (1 геймпасс · ${priceRobux} R$)`,
      createdBy: user ? operatorLabel(user) : "sheet-sync",
    },
  });
  return priceUsdt;
}

async function appendPartnerBuyoutBatch(input: {
  partner: Partner;
  batchId: string;
  priceRobux: number;
  priceUsdt: number;
  purchaseAccountName: string;
  createdBy: string;
}) {
  const ledger = await prisma.partnerLedgerEntry.upsert({
    where: {
      partnerId_batchId: { partnerId: input.partner.id, batchId: input.batchId },
    },
    create: {
      partnerId: input.partner.id,
      taskId: null,
      type: "BUYOUT",
      amount: -input.priceUsdt,
      currency: moneyCurrency(input.partner),
      rateUsdtPer1000: input.partner.robuxRateUsdtPer1000,
      robuxAmount: input.priceRobux,
      purchaseAccountName: input.purchaseAccountName,
      batchId: input.batchId,
      itemCount: 1,
      reference: `batch:${input.batchId}`,
      comment: "Пачка партнёрского выкупа",
      createdBy: input.createdBy,
    },
    update: {
      amount: { decrement: input.priceUsdt },
      robuxAmount: { increment: input.priceRobux },
      itemCount: { increment: 1 },
    },
  });
  const comment = `Списано за пачку: ${Math.abs(ledger.amount).toFixed(2)} USDT (${ledger.itemCount} геймпассов · ${(ledger.robuxAmount ?? 0).toLocaleString("ru-RU")} R$)`;
  return prisma.partnerLedgerEntry.update({
    where: { id: ledger.id },
    data: { comment },
  });
}

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
 * П3 (переписано в 5.7 B1): реконсиляция ручной правки статуса D для существующей задачи
 * GOOGLE_SHEETS в активном статусе (NEW/READY/FAILED). Ручное «готово» теперь закрывает
 * задачу КАК ВЫКУПЛЕННУЮ — со списанием USDT по номиналу C (решение владельца 2026-07-11,
 * отменяет прежнее «closedFromSheet без списания»).
 */
async function reconcilePartnerGoogleRow(input: {
  partner: Partner;
  user: TwaUser;
  task: PartnerBuyoutTask;
  rowStatus: string;
  rowComment: string;
  rowGamepassId: string | null;
  rowCells: unknown[];
  sheetPriceRobux: number | null;
  stats: GoogleSyncReconciliationStats;
}): Promise<ReconcileOutcome | null> {
  const { task, rowStatus, rowGamepassId, stats } = input;
  if (!(ACTIVE_TASK_STATUSES as readonly string[]).includes(task.status)) return null;

  if (rowStatus === GOOGLE_STATUS_DONE) {
    // Trello 2026-07-13: ручное «готово» фиксирует именно снимок A:C в момент
    // перехода и списывает ровно номинал C. Без положительного C факт не закрываем:
    // fallback на старую цену мог бы списать не ту сумму после одновременной правки.
    if (!input.sheetPriceRobux || input.sheetPriceRobux <= 0) {
      const conflict = `D=«готово», но в ${SHEET_AMOUNT_LETTER} нет положительного номинала — списание не выполнено`;
      stats.conflicts += 1;
      await prisma.partnerBuyoutTask.update({
        where: { id: task.id },
        data: { sheetRaw: mergeTaskSheetRaw(task, { conflict, conflictAt: new Date().toISOString() }) },
      });
      return { kind: "conflict", message: conflict };
    }
    const debitRobux = Math.round(input.sheetPriceRobux);
    const snapshotAt = new Date();
    const updatedTask = await prisma.partnerBuyoutTask.update({
      where: { id: task.id },
      data: {
        status: "DONE",
        completedAt: snapshotAt,
        robloxUsername: String(input.rowCells[SHEET_COL.nickname] ?? "").trim() || null,
        gamepassId: rowGamepassId,
        gamepassUrl: rowGamepassId ? `https://www.roblox.com/game-pass/${rowGamepassId}` : null,
        error: null,
        purchasePriceRobux: debitRobux,
        priceRobux: debitRobux,
        note: "Закрыто из таблицы: D=«готово» выставлено вручную",
        sheetRaw: mergeTaskSheetRaw(task, {
          closedFromSheet: true,
          conflict: null,
          cells: normalizeContentCells(input.rowCells),
          rowHash: computeGoogleRowHash(input.rowCells),
          contentHash: computeGoogleRowContentHash(input.rowCells),
          manualDoneSnapshotAt: snapshotAt.toISOString(),
          reconciledAt: snapshotAt.toISOString(),
        }),
      },
    });
    const debitedUsdt = await debitPartnerTaskFromSheet(
      input.partner,
      updatedTask,
      debitRobux,
      input.user,
      "Ручное «готово» в таблице",
    );
    stats.closedFromSheet += 1;
    return {
      kind: "closed",
      message: debitedUsdt > 0
        ? `Закрыта из таблицы (D=готово), списано ${debitedUsdt} USDT`
        : "Закрыта из таблицы (D=готово), без цены — списания нет",
    };
  }

  // Защита от сдвига нумерации (вставили/удалили строки выше): если в B теперь другой
  // геймпасс, чужую активную строку не закрываем и не отменяем — только конфликт-метка.
  // Для D=«готово» проверка выше намеренно не применяется: комментарий владельца требует
  // зафиксировать данные строки именно на момент ручного завершения.
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

/**
 * 5.7 C2: правка строки со статусом «готово» — DONE-задача не мутирует (остаётся такой,
 * какой была выкуплена), но получает пометку editedAfterDone с diff ячеек A:C и бейдж
 * «изменено после выкупа» в истории TWA. `before` фиксирует содержимое на момент выкупа,
 * editedAfterDoneHash защищает от повторных записей той же правки на каждом прогоне.
 */
async function markDoneRowEdited(task: PartnerBuyoutTask, cells: unknown[], stats: GoogleSyncReconciliationStats) {
  const currentHash = computeGoogleRowContentHash(cells);
  const storedHash = getStoredContentHash(task);
  if (!storedHash || storedHash === currentHash) return false;

  const raw = isRecord(task.sheetRaw) ? task.sheetRaw : {};
  if (raw.editedAfterDoneHash === currentHash) return false;
  const prevEdited = isRecord(raw.editedAfterDone) ? raw.editedAfterDone : null;
  const before = prevEdited && Array.isArray(prevEdited.before)
    ? prevEdited.before
    : Array.isArray(raw.cells) ? normalizeContentCells(raw.cells) : [];

  await prisma.partnerBuyoutTask.update({
    where: { id: task.id },
    data: {
      sheetRaw: mergeTaskSheetRaw(task, {
        editedAfterDone: { at: new Date().toISOString(), before, after: normalizeContentCells(cells) },
        editedAfterDoneHash: currentHash,
      }),
    },
  });
  stats.editedAfterDone += 1;
  return true;
}

/**
 * 5.7 B1: строка «готово» без задачи — исторический выкуп, внесённый в таблицу напрямую
 * (переходный период: владелец сам вписывает старые заказы чипом «готово»). Импортируется
 * как DONE-задача со списанием по номиналу C. resolveGamepass не зовём: это свершившийся
 * факт, а не заявка на выкуп — валидацию такая строка не проходит.
 */
async function importDoneRowFromSheet(input: {
  partner: Partner;
  user: TwaUser;
  spreadsheetId: string;
  sheetTitle: string;
  sheetId: number | null;
  rowNumber: number;
  externalRowId: string;
  cells: unknown[];
  gamepassId: string | null;
  sheetPriceRobux: number;
  stats: GoogleSyncReconciliationStats;
}) {
  const priceRobux = Math.round(input.sheetPriceRobux);
  const task = await prisma.partnerBuyoutTask.create({
    data: {
      partnerId: input.partner.id,
      externalSource: "GOOGLE_SHEETS",
      externalRowId: input.externalRowId,
      status: "DONE",
      completedAt: new Date(),
      robloxUsername: String(input.cells[SHEET_COL.nickname] ?? "").trim() || null,
      gamepassId: input.gamepassId,
      gamepassUrl: input.gamepassId ? `https://www.roblox.com/game-pass/${input.gamepassId}` : null,
      priceRobux,
      purchasePriceRobux: priceRobux,
      note: "Импортировано из таблицы как выкупленное: D=«готово»",
      sheetRaw: toJsonObject({
        ...buildGoogleSheetRaw({
          spreadsheetId: input.spreadsheetId,
          sheetTitle: input.sheetTitle,
          sheetId: input.sheetId,
          rowNumber: input.rowNumber,
          cells: input.cells,
          syncedBy: input.user ? operatorLabel(input.user) : null,
          sheetPriceRobux: priceRobux,
        }),
        closedFromSheet: true,
        importedDoneFromSheet: true,
      }),
    },
  });
  const debitedUsdt = await debitPartnerTaskFromSheet(
    input.partner,
    task,
    priceRobux,
    input.user,
    "Импорт строки «готово» из таблицы",
  );
  input.stats.importedDone += 1;
  return { task, debitedUsdt };
}

/**
 * 5.7 C1: строка с чипом «ошибка». Антон исправляет данные, не трогая чип, — sync замечает
 * смену содержимого A:C (contentHash) и перепроверяет строку: ошибка устранена → задача
 * READY + write-back D=«в ожидании» (заказ сам возвращается в очередь), ошибка осталась →
 * FAILED с новой причиной в E. Строка «ошибка» без задачи проверяется и создаётся первым же
 * sync. Перепроверка только при смене contentHash — не грузим Roblox на каждый прогон.
 */
async function processErrorStatusRow(input: {
  partner: Partner;
  user: TwaUser;
  spreadsheetId: string;
  sheetTitle: string;
  sheetId: number | null;
  rowNumber: number;
  externalRowId: string;
  cells: unknown[];
  existing: PartnerBuyoutTask | null;
  gamepassInput: string;
  gamepassId: string | null;
  sheetPriceRobux: number | null;
  stats: GoogleSyncReconciliationStats;
}): Promise<{ action: "created" | "updated" | "skipped"; failed: boolean; message: string; writeBacks: GoogleSheetsValueUpdate[] } | null> {
  const { existing, partner, user } = input;
  if (existing) {
    const storedHash = getStoredContentHash(existing);
    // Перепроверяем только исправленные строки: содержимое A:C не менялось — причина
    // ошибки уже отражена и в задаче, и в комментарии E.
    if (!storedHash || storedHash === computeGoogleRowContentHash(input.cells)) return null;
  }

  const nickname = String(input.cells[SHEET_COL.nickname] ?? "").trim() || null;
  const sheetPrice = input.sheetPriceRobux && input.sheetPriceRobux > 0 ? Math.round(input.sheetPriceRobux) : null;
  const action = existing ? "updated" as const : "created" as const;
  const commentWriteBack = (valid: boolean, message: string): GoogleSheetsValueUpdate[] => [
    { range: googleCellRange(input.sheetTitle, SHEET_COMMENT_LETTER, input.rowNumber), values: [[truncateGoogleMessage(partnerGamepassCommentValue(valid, message))]] },
  ];
  const buildRaw = (priceMismatch = false) => buildGoogleSheetRaw({
    spreadsheetId: input.spreadsheetId,
    sheetTitle: input.sheetTitle,
    sheetId: input.sheetId,
    rowNumber: input.rowNumber,
    cells: input.cells,
    syncedBy: user ? operatorLabel(user) : null,
    sheetPriceRobux: sheetPrice,
    priceMismatch,
  });

  if (!input.gamepassId || !sheetPrice) {
    const message = !input.gamepassId
      ? `Не найден ID геймпасса в колонке ${SHEET_GAMEPASS_LETTER}`
      : `Пустой или некорректный номинал в колонке ${SHEET_AMOUNT_LETTER}`;
    const data = {
      partnerId: partner.id,
      externalSource: "GOOGLE_SHEETS" as const,
      externalRowId: input.externalRowId,
      status: "FAILED" as const,
      robloxUsername: nickname,
      gamepassId: input.gamepassId,
      gamepassUrl: input.gamepassId ? `https://www.roblox.com/game-pass/${input.gamepassId}` : null,
      priceRobux: sheetPrice,
      error: message,
      sheetRaw: buildRaw(),
    };
    if (existing) await prisma.partnerBuyoutTask.update({ where: { id: existing.id }, data });
    else await prisma.partnerBuyoutTask.create({ data });
    return { action, failed: true, message, writeBacks: commentWriteBack(false, message) };
  }

  try {
    const gp = await resolveGamepass(input.gamepassInput || input.gamepassId);
    const ready = Boolean(gp.isForSale && gp.price && gp.price > 0 && gp.productId && gp.sellerId);
    const priceMismatch = Boolean(gp.price && sheetPrice !== gp.price);
    const mismatchWarning = priceMismatch ? `Цена ГП: ${gp.price} R$, в таблице ${sheetPrice} R$` : null;
    const rowOk = ready && !priceMismatch;
    const message = !ready ? "Геймпасс не продаётся или нет productId/sellerId" : mismatchWarning ?? "Готова к выкупу";
    const data = {
      partnerId: partner.id,
      externalSource: "GOOGLE_SHEETS" as const,
      externalRowId: input.externalRowId,
      status: rowOk ? "READY" as const : "FAILED" as const,
      robloxUsername: nickname,
      gamepassId: String(gp.gamepassId || input.gamepassId),
      gamepassUrl: `https://www.roblox.com/game-pass/${gp.gamepassId || input.gamepassId}`,
      productId: gp.productId ? String(gp.productId) : null,
      sellerId: gp.sellerId ? String(gp.sellerId) : null,
      sellerName: gp.sellerName || null,
      priceRobux: gp.price || sheetPrice,
      error: ready ? null : message,
      note: priceMismatch
        ? `Номинал из Sheets: ${sheetPrice} R$, цена GP: ${gp.price} R$`
        : `Номинал из Sheets: ${sheetPrice} R$`,
      sheetRaw: buildRaw(priceMismatch),
    };
    if (existing) await prisma.partnerBuyoutTask.update({ where: { id: existing.id }, data });
    else await prisma.partnerBuyoutTask.create({ data });

    if (rowOk) {
      input.stats.reactivated += 1;
      return {
        action,
        failed: false,
        message: "Исправлена: чип возвращён в «в ожидании»",
        writeBacks: [
          { range: googleCellRange(input.sheetTitle, SHEET_STATUS_LETTER, input.rowNumber), values: [[GOOGLE_STATUS_PENDING]] },
          ...commentWriteBack(true, message),
        ],
      };
    }
    return { action, failed: true, message, writeBacks: commentWriteBack(false, message) };
  } catch (err) {
    const message = truncateGoogleMessage(err instanceof Error ? err.message : "Ошибка проверки геймпасса");
    if (err instanceof BuyoutError) {
      const data = {
        partnerId: partner.id,
        externalSource: "GOOGLE_SHEETS" as const,
        externalRowId: input.externalRowId,
        status: "FAILED" as const,
        robloxUsername: nickname,
        gamepassId: input.gamepassId,
        gamepassUrl: `https://www.roblox.com/game-pass/${input.gamepassId}`,
        priceRobux: sheetPrice,
        error: message,
        sheetRaw: buildRaw(),
      };
      if (existing) await prisma.partnerBuyoutTask.update({ where: { id: existing.id }, data });
      else await prisma.partnerBuyoutTask.create({ data });
      return { action, failed: true, message, writeBacks: commentWriteBack(false, message) };
    }
    // Временная ошибка (сеть/Roblox API): задачу не трогаем — contentHash не обновится,
    // следующий sync перепроверит строку ещё раз.
    return { action: "skipped", failed: false, message: `Временная ошибка проверки: ${message}`, writeBacks: [] };
  }
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

  // DB-backed lease closes the race between a background GET-sync and a manual/force
  // sync running in another web instance. The old latestRun check was read-then-create:
  // two callers could both pass it and hit the task composite unique constraint.
  const leaseId = randomUUID();
  const leaseNow = new Date();
  const leaseStaleBefore = new Date(leaseNow.getTime() - GOOGLE_SYNC_RUNNING_STALE_MS);
  const lease = await prisma.partner.updateMany({
    where: {
      id: partner.id,
      OR: [
        { googleSyncLeaseAt: null },
        { googleSyncLeaseAt: { lt: leaseStaleBefore } },
      ],
    },
    data: { googleSyncLeaseId: leaseId, googleSyncLeaseAt: leaseNow },
  });
  if (lease.count !== 1) return { ...result, error: "Sync уже выполняется" };

  const run = await prisma.partnerImportRun.create({
    data: {
      partnerId: partner.id,
      source: "GOOGLE_SHEETS",
      spreadsheetId,
      createdBy: user ? operatorLabel(user) : null,
    },
  }).catch(async (err) => {
    await prisma.partner.updateMany({
      where: { id: partner.id, googleSyncLeaseId: leaseId },
      data: { googleSyncLeaseId: null, googleSyncLeaseAt: null },
    });
    throw err;
  });
  const writeBacks: GoogleSheetsValueUpdate[] = [];
  // 5.8: защиты строк копятся за прогон и применяются одним структурным batchUpdate.
  const protectionOps: PartnerProtectionOp[] = [];
  const reconciliation: GoogleSyncReconciliationStats = {
    closedFromSheet: 0,
    failedFromSheet: 0,
    cancelledFromSheet: 0,
    deletedFromSheet: 0,
    doneMarkedDeleted: 0,
    revived: 0,
    conflicts: 0,
    importedDone: 0,
    rowsReused: 0,
    reactivated: 0,
    editedAfterDone: 0,
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

    // Квота Google (60 read/min): все листы читаются одним values:batchGet вместо
    // values.get на каждый лист — прогон стоит 2 read-запроса, а не 1+N.
    const sheetRange = (title: string) => `${quoteGoogleSheetTitle(title)}!${SHEET_READ_RANGE}`;
    const rowsBySheetRange = await batchGetGoogleSheetValues(
      spreadsheetId,
      sheets.map((sheet) => sheetRange(sheet.title)),
    );

    for (const sheet of sheets) {
      const allRows = rowsBySheetRange.get(sheetRange(sheet.title)) ?? [];
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
        // это удаление заказа: задача уходит из TWA полностью. D=«готово» не трогаем
        // (операционная история); D=«ошибка» с 5.7 (A3) тоже удаляет задачу — раньше
        // очистка строки-ошибки оставляла вечную зомби-FAILED в активном списке.
        const rowCleared = SHEET_CONTENT_CELLS
          .every((i) => String(cells[i] ?? "").trim() === "");

        // Trello 2026-07-13: externalRowId выкупленной строки — одноразовый.
        // После DONE строку нельзя освободить под новый заказ, даже если владелец успел
        // изменить A:C или снять чип. Сохраняем исходную задачу и BUYOUT, отмечаем правку,
        // восстанавливаем «готово» и защиту. Это исключает второй выкуп/списание по той же
        // физической строке и одновременно лечит удалённую вручную защиту.
        const settledPolicy = settledPartnerRowPolicy(existing?.status ?? null, status);
        if (existing && settledPolicy.preserveTask) {
          const edited = await markDoneRowEdited(existing, cells, reconciliation);
          if (edited) {
            result.updated += 1;
            rowItem("updated", existing.gamepassId, "Выкупленная строка изменена — повторный выкуп запрещён");
          } else {
            result.skipped += 1;
            rowItem("skipped", existing.gamepassId, "Задача уже выкуплена; строка закреплена за этим выкупом");
          }
          if (settledPolicy.restoreDoneStatus || String(cells[SHEET_COL.comment] ?? "").trim() !== "") {
            writeBacks.push(
              { range: googleCellRange(sheet.title, SHEET_STATUS_LETTER, rowNumber), values: [[GOOGLE_STATUS_DONE]] },
              { range: googleCellRange(sheet.title, SHEET_COMMENT_LETTER, rowNumber), values: [[""]] },
            );
          }
          if (getTaskProtectedRangeId(existing) === null) {
            protectionOps.push({ kind: "protect", taskId: existing.id, sheetId: sheet.sheetId, rowNumber });
          }
          continue;
        }

        if (rowCleared && existing && status !== GOOGLE_STATUS_DONE) {
          // DONE/PURCHASING не трогаем и «готово» в очищенную строку не переписываем:
          // Антон мог очистить строку под переиспользование.
          if (existing.status === "PURCHASING") continue;
          const outcome = await deletePartnerTaskForRemovedRow(existing, reconciliation, "Строка очищена в таблице");
          result.updated += 1;
          rowItem("updated", existing.gamepassId, outcome === "deleted"
            ? "Удалена из TWA: строка очищена в таблице"
            : "Отменена: строка очищена, но по задаче есть ledger-записи");
          continue;
        }

        if (!isPending) {
          const rowComment = String(cells[SHEET_COL.comment] ?? "").trim();
          const nonPendingSheetPrice = parseImportNumber(nominal);

          if (status === GOOGLE_STATUS_DONE) {
            if (!existing) {
              if (nonPendingSheetPrice && nonPendingSheetPrice > 0) {
                // 5.7 B1: исторический выкуп, внесённый чипом «готово» напрямую —
                // импортируем как выполненный со списанием по номиналу C.
                const { task: importedDoneTask, debitedUsdt } = await importDoneRowFromSheet({
                  partner,
                  user,
                  spreadsheetId,
                  sheetTitle: sheet.title,
                  sheetId: sheet.sheetId,
                  rowNumber,
                  externalRowId,
                  cells,
                  gamepassId,
                  sheetPriceRobux: nonPendingSheetPrice,
                  stats: reconciliation,
                });
                // 5.8 (О1): ручное «готово» тоже лочится — строка оплачена.
                protectionOps.push({ kind: "protect", taskId: importedDoneTask.id, sheetId: sheet.sheetId, rowNumber });
                result.created += 1;
                rowItem("created", gamepassId, `Импортирована как выкупленная (D=«готово»), списано ${debitedUsdt} USDT`);
              } else if (gamepassId || hasAmount || String(cells[SHEET_COL.nickname] ?? "").trim()) {
                // «готово» без распознанного номинала — списание посчитать нечем.
                result.skipped += 1;
                rowItem("skipped", gamepassId, `Строка «готово» без номинала в ${SHEET_AMOUNT_LETTER} — не импортирована`);
              }
              continue;
            }
            // Активная задача + ручное «готово» → реконсиляция ниже (DONE + списание).
          }

          // 5.7 C1: чип «ошибка» — перепроверяем исправленное содержимое строки
          // (FAILED-задача с изменившимся A:C) или создаём задачу по строке без задачи.
          if (status === GOOGLE_STATUS_ERROR
            && (existing ? existing.status === "FAILED" : Boolean(gamepassId || hasAmount))) {
            const checked = await processErrorStatusRow({
              partner,
              user,
              spreadsheetId,
              sheetTitle: sheet.title,
              sheetId: sheet.sheetId,
              rowNumber,
              externalRowId,
              cells,
              existing,
              gamepassInput,
              gamepassId,
              sheetPriceRobux: nonPendingSheetPrice,
              stats: reconciliation,
            });
            if (checked) {
              if (checked.action === "created") result.created += 1;
              else if (checked.action === "updated") result.updated += 1;
              else result.skipped += 1;
              if (checked.failed) result.failed += 1;
              writeBacks.push(...checked.writeBacks);
              rowItem(checked.action, gamepassId, checked.message);
              continue;
            }
            if (!existing) continue;
            // FAILED-задача без изменений строки — реконсиляция ниже ничего не сделает.
          }

          // Реконсиляция ручных статусов: D сменили руками — приводим внутреннюю задачу
          // в соответствие (готово -> DONE со списанием, ошибка -> FAILED, прочее -> CANCELLED).
          if (existing) {
            const outcome = await reconcilePartnerGoogleRow({
              partner,
              user,
              task: existing,
              rowStatus: status,
              rowComment,
              rowGamepassId: gamepassId,
              rowCells: cells,
              sheetPriceRobux: nonPendingSheetPrice,
              stats: reconciliation,
            });
            if (outcome) {
              // 5.8 (О1): ручное «готово» = выкуплено со списанием → строка лочится.
              if (outcome.kind === "closed" && getTaskProtectedRangeId(existing) === null) {
                protectionOps.push({ kind: "protect", taskId: existing.id, sheetId: sheet.sheetId, rowNumber });
              }
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
            const doneRaw = isRecord(task.sheetRaw) ? task.sheetRaw : null;
            // Архив B2: строка жива, но принадлежит новому заказу — «удалена из таблицы»
            // для такой задачи неверно.
            if (doneRaw?.rowReusedForNewOrder === true) continue;
            if (doneRaw?.rowDeletedFromSheet === true) continue;
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

    // 5.11: reconcile protection state from the DB after row processing. Active rows
    // receive a point D-lock; terminal/error rows lose it; DONE keeps/repairs A:D.
    // The operations still flush in one structural batch below.
    const protectionTasks = await prisma.partnerBuyoutTask.findMany({
      where: { partnerId: partner.id, externalSource: "GOOGLE_SHEETS" },
    });
    const sheetIds = new Map(sheets.map((sheet) => [sheet.title, sheet.sheetId]));
    for (const task of protectionTasks) {
      const meta = getGoogleTaskMeta(task);
      if (!meta) continue;
      const sheetId = typeof meta.raw.sheetId === "number" ? meta.raw.sheetId : sheetIds.get(meta.sheetTitle);
      if (typeof sheetId !== "number") continue;
      const pendingProtectionId = getTaskPendingProtectedRangeId(task);
      const pendingStatus = task.status === "NEW" || task.status === "READY" || task.status === "PURCHASING";

      if (pendingStatus) {
        if (pendingProtectionId === null) {
          protectionOps.push({ kind: "protect-pending", taskId: task.id, sheetId, rowNumber: meta.rowNumber });
        }
        continue;
      }
      if (pendingProtectionId !== null) {
        protectionOps.push({
          kind: "unprotect",
          protectedRangeId: pendingProtectionId,
          taskId: task.id,
          clearField: "pendingProtectedRangeId",
        });
      }
      if (task.status === "DONE" && getTaskProtectedRangeId(task) === null) {
        protectionOps.push({ kind: "protect", taskId: task.id, sheetId, rowNumber: meta.rowNumber });
      }
    }

    try {
      await batchUpdateGoogleSheetValues(spreadsheetId, writeBacks);
    } catch (err) {
      result.status = "partial";
      result.error = err instanceof Error ? err.message : "Ошибка write-back в Google Sheets";
    }

    // 5.8: защиты строк — отдельным структурным батчем (значения выше — values-путь).
    const protection: GoogleSyncProtectionStats = {
      locked: 0,
      healed: 0,
      unlocked: 0,
      failed: 0,
      pendingLocked: 0,
      pendingUnlocked: 0,
    };
    const protectionError = await applyPartnerProtectionOps(spreadsheetId, protectionOps, protection);
    if (protection.locked || protection.healed || protection.unlocked || protection.failed
      || protection.pendingLocked || protection.pendingUnlocked) {
      result.diagnostics.protection = protection;
    }
    if (protectionError) {
      result.status = "partial";
      result.error = result.error
        ? `${result.error}; защита строк: ${protectionError}`
        : `Защита строк: ${protectionError}`;
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
  } finally {
    await prisma.partner.updateMany({
      where: { id: partner.id, googleSyncLeaseId: leaseId },
      data: { googleSyncLeaseId: null, googleSyncLeaseAt: null },
    });
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
  const [tasks, ledgerEntries, importRuns, balanceAgg, spentAgg, statusGroups, doneWithPurchaseAgg, doneWithoutPurchaseAgg, rateGroups, rateChanges] = await Promise.all([
    prisma.partnerBuyoutTask.findMany({
      where: { partnerId: partner.id },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    }),
    prisma.partnerLedgerEntry.findMany({
      where: { partnerId: partner.id, currency },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      include: {
        task: { select: { id: true, robloxUsername: true, gamepassId: true } },
      },
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
    // 5.7: счётчики статусов и «Выкуплено» — по всей БД, а не по срезу take:100,
    // иначе контрольная цифра владельца ломается при росте числа задач.
    prisma.partnerBuyoutTask.groupBy({
      by: ["status"],
      where: { partnerId: partner.id },
      _count: { _all: true },
    }),
    // Цена задачи = purchasePriceRobux ?? priceRobux (getTaskPrice) — COALESCE в Prisma
    // aggregate не выразить, поэтому две суммы по наличию purchasePriceRobux.
    prisma.partnerBuyoutTask.aggregate({
      where: { partnerId: partner.id, status: "DONE", purchasePriceRobux: { not: null } },
      _sum: { purchasePriceRobux: true },
    }),
    prisma.partnerBuyoutTask.aggregate({
      where: { partnerId: partner.id, status: "DONE", purchasePriceRobux: null },
      _sum: { priceRobux: true },
    }),
    // 5.9 A4: отчёт «по какому курсу сколько куплено» — по структурному rateUsdtPer1000
    // BUYOUT-списаний (записи до бэкфилла группируются в rate=null → «курс не записан»).
    prisma.partnerLedgerEntry.groupBy({
      by: ["rateUsdtPer1000"],
      where: { partnerId: partner.id, currency, type: "BUYOUT" },
      _sum: { amount: true, robuxAmount: true, itemCount: true },
    }),
    prisma.partnerRateChange.findMany({
      where: { partnerId: partner.id },
      orderBy: [{ createdAt: "desc" }],
      take: 10,
    }),
  ]);

  const balanceUsdt = balanceAgg._sum.amount ?? 0;
  const spentUsdt = Math.abs(spentAgg._sum.amount ?? 0);
  const statusCount = (status: string) => statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const totalTasks = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
  // 5.7 B1: «Выкуплено» считает ВСЕ DONE — ручные «готово» из таблицы теперь тоже
  // списываются и являются выкупленными (исключение closedFromSheet убрано).
  const doneRobux = (doneWithPurchaseAgg._sum.purchasePriceRobux ?? 0) + (doneWithoutPurchaseAgg._sum.priceRobux ?? 0);
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
  const rateReport = rateGroups
    .map((group) => ({
      rate: group.rateUsdtPer1000,
      buyouts: group._sum.itemCount ?? 0,
      totalRobux: group._sum.robuxAmount ?? 0,
      totalUsdt: Math.abs(group._sum.amount ?? 0),
    }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

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
      total: totalTasks,
      ready: statusCount("READY"),
      purchasing: statusCount("PURCHASING"),
      done: statusCount("DONE"),
      failed: statusCount("FAILED"),
      mismatches,
      conflicts,
    },
    rateReport,
    rateChanges,
  };
}

const PARTNER_VIEW_PAGE_SIZE = 30;
type PartnerView = "ledger" | "history" | "tasks";

async function loadPartnerView(partner: Partner, view: PartnerView, cursor: string | null) {
  const take = PARTNER_VIEW_PAGE_SIZE + 1;

  if (view === "ledger") {
    const rows = await prisma.partnerLedgerEntry.findMany({
      where: { partnerId: partner.id, currency: moneyCurrency(partner) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : undefined,
      include: {
        task: { select: { id: true, robloxUsername: true, gamepassId: true } },
      },
    });
    const hasMore = rows.length > PARTNER_VIEW_PAGE_SIZE;
    const items = hasMore ? rows.slice(0, PARTNER_VIEW_PAGE_SIZE) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  }

  const rows = await prisma.partnerBuyoutTask.findMany({
    where: {
      partnerId: partner.id,
      ...(view === "history" ? { status: { in: ["DONE", "CANCELLED"] as const } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
  });
  const hasMore = rows.length > PARTNER_VIEW_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PARTNER_VIEW_PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
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

    const view = req.nextUrl.searchParams.get("view");
    if (view === "ledger" || view === "history" || view === "tasks") {
      const cursor = req.nextUrl.searchParams.get("cursor");
      return json({ ok: true, view, ...(await loadPartnerView(partner, view, cursor)) });
    }

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

    if (action === "cancel-ledger-entry") {
      // 5.7 E1: отмена ошибочного пополнения = полное удаление записи (решение владельца,
      // сторно-ADJUSTMENT не заводим). Только TOPUP без привязки к задаче.
      const entryId = String(body.entryId || "");
      if (!entryId) return json({ ok: false, error: "entryId обязателен" }, 400);

      const entry = await prisma.partnerLedgerEntry.findFirst({
        where: { id: entryId, partnerId: partner.id },
      });
      if (!entry) return json({ ok: false, error: "Запись не найдена" }, 404);
      if (entry.type !== "TOPUP" || entry.taskId) {
        return json({ ok: false, error: "Отменить можно только пополнение" }, 409);
      }

      await prisma.partnerLedgerEntry.delete({ where: { id: entry.id } });

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

      const newRate = Math.round(rate * 10000) / 10000;
      // 5.9 A2: каждая смена курса — запись в журнал, отчёт «по какому курсу сколько
      // куплено» опирается на неё и на rateUsdtPer1000 в BUYOUT-списаниях.
      const [updatedPartner] = await prisma.$transaction([
        prisma.partner.update({
          where: { id: partner.id },
          data: { robuxRateUsdtPer1000: newRate },
        }),
        ...(newRate !== partner.robuxRateUsdtPer1000
          ? [prisma.partnerRateChange.create({
            data: {
              partnerId: partner.id,
              rate: newRate,
              previousRate: partner.robuxRateUsdtPer1000,
              createdBy: operatorLabel(user),
            },
          })]
          : []),
      ]);

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
      // №8 ультра-ревью: «Готово» без цены закрывало задачу бесплатно — неучтённый выкуп.
      // Требуем цену: номинал в строке таблицы (и re-sync) или purchasePriceRobux в запросе.
      if (!priceRobux || priceRobux <= 0) {
        return json({ ok: false, error: "У задачи нет цены — заполните номинал в таблице или передайте фактическую цену" }, 400);
      }
      // Баланс НЕ блокирует ручное «Готово»: владелец разрешил уходить в минус —
      // ручной выкуп должен срабатывать всегда. Отрицательный баланс подсвечивается
      // в TWA и гасится пополнением.
      const priceUsdt = taskCostUsdt(priceRobux, partner);

      const updatedTask = await prisma.partnerBuyoutTask.update({
        where: { id: task.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          purchaseAccountName: String(body.purchaseAccountName || "").trim() || null,
          purchaseBatchId: `manual:${task.id}`,
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
            rateUsdtPer1000: partner.robuxRateUsdtPer1000,
            robuxAmount: priceRobux,
            purchaseAccountName: updatedTask.purchaseAccountName || "Вручную / из таблицы",
            batchId: updatedTask.purchaseBatchId,
            itemCount: 1,
            reference: updatedTask.gamepassId,
            comment: `Ручная отметка: ${priceUsdt.toFixed(2)} USDT (1 геймпасс · ${priceRobux} R$)`,
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
      const purchaseBatchId = (String(body.purchaseBatchId || "").trim() || randomUUID()).slice(0, 120);

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
        // Внутренняя ошибка операций — в таблицу Антона не пишем вообще, а задачу
        // возвращаем в READY (№7): наша проблема не должна выбивать её из батч-плана.
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "READY", error: "Roblox cookie не задан" },
        });
        return json({ ok: false, error: "Roblox cookie не задан" }, 409);
      }

      const price = task.priceRobux ?? 0;
      if (!price || !task.gamepassId) {
        const failedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "FAILED", error: "В задаче нет цены/gamepassId" },
        });
        await writeBackPartnerTask(failedTask, "error", "В задаче нет цены/gamepassId");
        return json({ ok: false, error: "В задаче нет цены/gamepassId" }, 409);
      }

      // Managed/Regional Pricing: task.priceRobux is the seller's global/base
      // price, while Roblox requires the authenticated buyer's current price
      // in expectedPrice. Re-resolve immediately before every real purchase.
      let buyerGp;
      try {
        buyerGp = await resolveGamepassForBuyer(task.gamepassId, settings.robloxCookie);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Не удалось получить персональную цену Roblox";
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "READY", error: message },
        });
        return json({ ok: false, error: message }, err instanceof BuyoutError ? err.status : 502);
      }
      if (!buyerGp.isForSale || Math.abs(buyerGp.basePriceInRobux - price) > 2) {
        const message = !buyerGp.isForSale
          ? "Геймпасс не на продаже"
          : `Базовая цена ГП ${buyerGp.basePriceInRobux} R$, в задаче ${price} R$`;
        const failedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id }, data: { status: "FAILED", error: message },
        });
        await writeBackPartnerTask(failedTask, "error", message);
        return json({ ok: true, success: false, error: message, partner, ...(await loadPartnerState(partner)) });
      }
      if (buyerGp.hasUnsafeBuyerPrice) {
        const message = `Региональная цена ${buyerGp.price}/${buyerGp.basePriceInRobux} R$: покупка запрещена`;
        const failedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id }, data: { status: "FAILED", error: message },
        });
        await writeBackPartnerTask(failedTask, "error", message);
        return json({ ok: true, success: false, error: message, partner, ...(await loadPartnerState(partner)) });
      }
      // Баланс НЕ блокирует выкуп: владелец разрешил уходить в минус — кнопка «Купить»
      // должна срабатывать всегда (даже в минус). Списание в ledger идёт как обычно;
      // отрицательный баланс подсвечивается в TWA и гасится пополнением.
      const priceUsdt = taskCostUsdt(price, partner);

      let result: PurchaseResult;
      try {
        // gamepassId — для контрольной проверки владения при провале (Ф1):
        // ложный провал здесь = ложный refund в USDT-ledger партнёра.
        result = await purchaseGamepassWithCookie(settings.robloxCookie, {
          productId: buyerGp.productId,
          price: buyerGp.price,
          sellerId: buyerGp.sellerId,
          gamepassId: task.gamepassId,
        });
      } catch (err) {
        // CSRF/сеть/нет ответа Roblox — внутреннее и временное: раньше задача зависала
        // в PURCHASING навсегда. Возвращаем READY, в таблицу не пишем.
        const message = err instanceof Error ? err.message : "Ошибка покупки Roblox";
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "READY", error: message },
        });
        return json({ ok: false, error: message }, err instanceof BuyoutError ? err.status : 502);
      }
      if (!result.success) {
        // №5+№7 ультра-ревью: классификация — typed-код из purchaseGamepassWithCookie,
        // а не regex по локализованному msg. internal (cookie, Robux донора) — наша
        // проблема: задача возвращается в READY (остаётся в батч-плане), строку красным
        // не помечаем. row (цена сменилась, не продаётся) — FAILED + чип «ошибка».
        // unknown — FAILED для ручного разбора, но на Антона не вешаем (только комментарий).
        const internalFailure = result.failureKind === "internal";
        const failedTask = await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: internalFailure ? "READY" : "FAILED", error: result.msg },
        });
        await writeBackPartnerTask(failedTask, result.failureKind === "row" ? "error" : "comment", result.msg);
        return json({ ok: true, success: false, error: result.msg, balance: result.balance, partner, ...(await loadPartnerState(partner)) });
      }

      const doneTask = await prisma.partnerBuyoutTask.update({
        where: { id: task.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          purchaseAccountName: settings.robloxAccountName || null,
          purchaseBatchId,
          purchasePriceRobux: result.price ?? buyerGp.price,
          error: null,
        },
      });
      await writeBackPartnerTask(doneTask, "done");

      await appendPartnerBuyoutBatch({
        partner,
        batchId: purchaseBatchId,
        priceRobux: price,
        priceUsdt,
        purchaseAccountName: settings.robloxAccountName || "cookie-аккаунт",
        createdBy: operatorLabel(user),
      });

      const state = await loadPartnerState(partner);
      return json({ ok: true, success: true, balance: result.balance, partner, ...state });
    }

    if (action === "notify-buyout") {
      // Уведомление в админку о выкупе пачки/задачи Антона (владелец: обязательно).
      // Клиент шлёт только список id выкупленных задач; суммы берём из БД
      // (DONE-задачи + их BUYOUT-списания), чтобы карточку нельзя было подделать.
      const rawIds = Array.isArray(body.taskIds) ? body.taskIds : [];
      const taskIds = rawIds.map((x) => String(x)).filter(Boolean);
      const failRaw = Number(body.failCount);
      const failCount = Number.isFinite(failRaw) && failRaw > 0 ? Math.floor(failRaw) : 0;
      if (taskIds.length === 0) return json({ ok: false, error: "taskIds обязателен" }, 400);

      const doneTasks = await prisma.partnerBuyoutTask.findMany({
        where: { id: { in: taskIds }, partnerId: partner.id, status: "DONE" },
      });
      if (doneTasks.length === 0) return json({ ok: true, notified: { admins: 0, sent: 0 } });

      const batchIds = doneTasks.map((task) => task.purchaseBatchId).filter((id): id is string => Boolean(id));
      const buyouts = await prisma.partnerLedgerEntry.findMany({
        where: {
          partnerId: partner.id,
          type: "BUYOUT",
          OR: [
            { taskId: { in: doneTasks.map((task) => task.id) } },
            ...(batchIds.length > 0 ? [{ batchId: { in: batchIds } }] : []),
          ],
        },
      });
      const buyoutByTask = new Map(buyouts.map((b) => [b.taskId, b]));
      const buyoutByBatch = new Map(buyouts.filter((entry) => entry.batchId).map((entry) => [entry.batchId, entry]));

      const items: PartnerBuyoutNotifyItem[] = doneTasks.map((t) => {
        const b = (t.purchaseBatchId ? buyoutByBatch.get(t.purchaseBatchId) : null) ?? buyoutByTask.get(t.id);
        const robux = getTaskPrice(t);
        const rate = b?.rateUsdtPer1000 ?? partner.robuxRateUsdtPer1000;
        return {
          nick: t.robloxUsername,
          gamepassId: t.gamepassId,
          robux,
          usdt: Math.round((robux * rate / 1000) * 100) / 100,
        };
      });
      const totalRobux = items.reduce((sum, it) => sum + it.robux, 0);
      const totalUsdt = items.reduce((sum, it) => sum + it.usdt, 0);
      const balanceUsdt = await getPartnerBalance(partner);

      const notified = await notifyPartnerBuyout({
        partnerName: partner.name,
        items,
        totalRobux,
        totalUsdt,
        balanceUsdt,
        rate: partner.robuxRateUsdtPer1000,
        failCount,
        operator: operatorLabel(user),
      });
      return json({ ok: true, notified });
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
