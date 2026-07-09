import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { Prisma, type Partner, type PartnerBuyoutTask } from "@prisma/client";

import { BuyoutError, purchaseGamepassWithCookie, resolveGamepass } from "@/lib/roblox-buyout";
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
    "ledgercurrency",
    "robuxrateusdtper1000",
    "googlesheet",
    "externalsource",
    "xlsx_upload",
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

function extractGamepassIdFromImport(input: string) {
  const gamepassMatch = input.match(/game-pass(?:es)?\/(\d+)/i);
  if (gamepassMatch?.[1]) return gamepassMatch[1];

  const numericMatch = input.match(/\b(\d{5,})\b/);
  return numericMatch?.[1] ?? null;
}

function importFileKey(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80) || "upload";
}

function toJsonObject(value: Record<string, unknown>) {
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

async function requireTwaUser(req: NextRequest) {
  const user = await extractTwaUser(req);
  if (!user) throw new BuyoutError("Unauthorized", 401);
  return user;
}

async function getPartner(slug: string) {
  const name = PARTNER_NAME_BY_SLUG[slug];
  if (!name) return null;

  return prisma.partner.upsert({
    where: { slug },
    update: slug === "anton" ? {
      ledgerCurrency: DEFAULT_PARTNER_CURRENCY,
    } : {},
    create: {
      slug,
      name,
      ledgerCurrency: DEFAULT_PARTNER_CURRENCY,
      robuxRateUsdtPer1000: DEFAULT_ANTON_RATE_USDT_PER_1000_R,
    },
  });
}

async function loadPartnerState(partner: Partner) {
  const currency = moneyCurrency(partner);
  const [tasks, ledgerEntries, balanceAgg, spentAgg] = await Promise.all([
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
  const doneRobux = tasks
    .filter((task) => task.status === "DONE")
    .reduce((sum, task) => sum + getTaskPrice(task), 0);
  const reservedUsdt = tasks
    .filter((task) => task.status === "READY" || task.status === "PURCHASING")
    .reduce((sum, task) => sum + taskCostUsdt(getTaskPrice(task), partner), 0);

  return {
    tasks,
    ledgerEntries,
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

    const state = await loadPartnerState(partner);
    return json({ ok: true, partner, ...state });
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
        data: { status: "CANCELLED", error: null },
      });
      if (cancelled.count !== 1) return json({ ok: false, error: "Задача уже обрабатывается или завершена" }, 409);

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
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "FAILED", error: "В задаче нет цены/productId/sellerId" },
        });
        return json({ ok: false, error: "В задаче нет цены/productId/sellerId" }, 409);
      }

      const priceUsdt = taskCostUsdt(price, partner);
      const balanceBeforePurchase = await getPartnerBalance(partner);
      if (balanceBeforePurchase < priceUsdt) {
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "READY", error: "Недостаточно баланса партнёра" },
        });
        return json({ ok: false, error: "Недостаточно баланса партнёра", partner, ...(await loadPartnerState(partner)) }, 409);
      }

      const result = await purchaseGamepassWithCookie(settings.robloxCookie, { productId, price, sellerId });
      if (!result.success) {
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "FAILED", error: result.msg },
        });
        return json({ ok: true, success: false, error: result.msg, balance: result.balance, partner, ...(await loadPartnerState(partner)) });
      }

      await prisma.partnerBuyoutTask.update({
        where: { id: task.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          purchaseAccountName: settings.robloxAccountName || null,
          purchasePriceRobux: price,
          error: null,
        },
      });

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
