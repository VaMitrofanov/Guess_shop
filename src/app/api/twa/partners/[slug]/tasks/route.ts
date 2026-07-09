import { NextRequest, NextResponse } from "next/server";

import type { PartnerBuyoutTask } from "@prisma/client";

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

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function operatorLabel(user: NonNullable<TwaUser>) {
  return `${user.firstName || "TWA"}:${user.userId}`;
}

function getTaskPrice(task: Pick<PartnerBuyoutTask, "priceRobux" | "purchasePriceRobux">) {
  return task.purchasePriceRobux ?? task.priceRobux ?? 0;
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
    update: {},
    create: { slug, name },
  });
}

async function loadPartnerState(partnerId: string) {
  const [tasks, ledgerEntries, balanceAgg, spentAgg] = await Promise.all([
    prisma.partnerBuyoutTask.findMany({
      where: { partnerId },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    }),
    prisma.partnerLedgerEntry.findMany({
      where: { partnerId, currency: "R$" },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
    prisma.partnerLedgerEntry.aggregate({
      where: { partnerId, currency: "R$" },
      _sum: { amount: true },
    }),
    prisma.partnerLedgerEntry.aggregate({
      where: { partnerId, currency: "R$", type: "BUYOUT" },
      _sum: { amount: true },
    }),
  ]);

  const balanceRobux = balanceAgg._sum.amount ?? 0;
  const spentRobux = Math.abs(spentAgg._sum.amount ?? 0);

  return {
    tasks,
    ledgerEntries,
    summary: {
      balanceRobux,
      spentRobux,
      total: tasks.length,
      ready: tasks.filter((task) => task.status === "READY").length,
      purchasing: tasks.filter((task) => task.status === "PURCHASING").length,
      done: tasks.filter((task) => task.status === "DONE").length,
      failed: tasks.filter((task) => task.status === "FAILED").length,
    },
  };
}

async function getPartnerBalance(partnerId: string) {
  const aggregate = await prisma.partnerLedgerEntry.aggregate({
    where: { partnerId, currency: "R$" },
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

    const state = await loadPartnerState(partner.id);
    return json({ ok: true, partner, ...state });
  } catch (err) {
    if (err instanceof BuyoutError) return json({ ok: false, error: err.message }, err.status);
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");

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

      const state = await loadPartnerState(partner.id);
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
          currency: "R$",
          comment: String(body.comment || "").trim() || "Пополнение баланса партнёра",
          createdBy: operatorLabel(user),
        },
      });

      const state = await loadPartnerState(partner.id);
      return json({ ok: true, partner, ...state });
    }

    if (action === "cancel-task") {
      const taskId = String(body.taskId || "");
      if (!taskId) return json({ ok: false, error: "taskId обязателен" }, 400);

      const cancelled = await prisma.partnerBuyoutTask.updateMany({
        where: { id: taskId, partnerId: partner.id, status: { notIn: ["DONE", "CANCELLED", "PURCHASING"] } },
        data: { status: "CANCELLED", error: null },
      });
      if (cancelled.count !== 1) return json({ ok: false, error: "Задача уже обрабатывается или завершена" }, 409);

      const state = await loadPartnerState(partner.id);
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

      const price = manualPrice ?? getTaskPrice(task);
      if (price > 0) {
        const balance = await getPartnerBalance(partner.id);
        if (balance < price) {
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

      if (price > 0) {
        await prisma.partnerLedgerEntry.create({
          data: {
            partnerId: partner.id,
            taskId: updatedTask.id,
            type: "BUYOUT",
            amount: -price,
            currency: "R$",
            reference: updatedTask.gamepassId,
            comment: "Ручная отметка партнёрского выкупа",
            createdBy: operatorLabel(user),
          },
        });
      }

      const state = await loadPartnerState(partner.id);
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

      const balanceBeforePurchase = await getPartnerBalance(partner.id);
      if (balanceBeforePurchase < price) {
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "READY", error: "Недостаточно баланса партнёра" },
        });
        return json({ ok: false, error: "Недостаточно баланса партнёра", partner, ...(await loadPartnerState(partner.id)) }, 409);
      }

      const result = await purchaseGamepassWithCookie(settings.robloxCookie, { productId, price, sellerId });
      if (!result.success) {
        await prisma.partnerBuyoutTask.update({
          where: { id: task.id },
          data: { status: "FAILED", error: result.msg },
        });
        return json({ ok: true, success: false, error: result.msg, balance: result.balance, partner, ...(await loadPartnerState(partner.id)) });
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
            amount: -price,
            currency: "R$",
            reference: task.gamepassId,
            comment: `Партнёрский выкуп через ${settings.robloxAccountName || "cookie-аккаунт"}`,
            createdBy: operatorLabel(user),
          },
        });
      }

      const state = await loadPartnerState(partner.id);
      return json({ ok: true, success: true, balance: result.balance, partner, ...state });
    }

    return json({ ok: false, error: "Неизвестное действие" }, 400);
  } catch (err) {
    if (err instanceof BuyoutError) return json({ ok: false, error: err.message }, err.status);
    console.error("[partners/tasks POST]", err);
    return json({ ok: false, error: "Ошибка партнёрского действия" }, 500);
  }
}
