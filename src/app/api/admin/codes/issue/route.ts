import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-access";
import { issueCodeManually } from "@/lib/codes/manual-issue";
import { notifyCodeAdmins } from "@/lib/codes/admin-notify";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🎟 Выдать код из блока «Коды» (16.11.2026, TWA и «Обзор» сайта).
 *
 * То же ядро, что у бота и `scripts/codes-issue.mjs` (`issueCodeManually`):
 * код шифруется, заказ закрывается одной транзакцией, покупателю уходит письмо
 * или сообщение в чат. Сам код в ответ и в уведомление не попадает никогда.
 * После выдачи в тему «Коды» уходит «🟢 выдан · кто», иначе беседа продолжала бы
 * считать заказ ждущим и кто-то выдал бы второй код.
 */
const Schema = z.object({
  publicId: z.string().trim().regex(/^CODE-[A-Z0-9]{8}$/i),
  code: z.string().trim().min(6).max(300),
});

const REASON: Record<string, string> = {
  not_found: "заказ не найден",
  not_paid: "заказ ещё не оплачен",
  already: "код по этому заказу уже выдан — второй не выдаём",
  refunded: "по заказу вернули деньги",
  duplicate_code: "этот код уже есть в базе — нужен другой",
  bad_code: "не похоже на код Roblox (латиница и цифры, 6–40 знаков)",
  denomination_mismatch: "номинал не совпал с заказом",
  count_mismatch: "в этом заказе несколько кодов (2 000 = 2 × 1 000) — впишите все в одно поле через запятую",
};

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "Нет доступа" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Нужны номер заказа и код" }, { status: 400 });

  const actor = (admin.displayName || "админ").slice(0, 40);
  const via = admin.via === "telegram" ? "TWA" : "сайт";
  try {
    const result = await issueCodeManually({ ...parsed.data, label: `${via}-${actor}`.slice(0, 60) });
    if (!result.ok) {
      return NextResponse.json({ ok: false, status: result.status, error: REASON[result.status] ?? "не выдан" }, { status: 409 });
    }
    const order = await prisma.codeOrder.findUnique({
      where: { publicId: result.publicId },
      select: { denomination: true, finalAmountKopecks: true },
    }).catch(() => null);
    const EMAIL_WORD: Record<string, string | null> = {
      sent: "письмо ушло", scheduled: "открытка уйдёт по расписанию", failed: "письмо НЕ ушло",
      exhausted: "письмо НЕ ушло", no_address: null, not_issued: null,
    };
    const delivered = [
      EMAIL_WORD[String(result.email)] ?? null,
      result.chat === true ? "в чат бота ушло" : result.chat === false ? "в чат бота НЕ ушло" : null,
    ].filter(Boolean).join(" · ");
    // Строка «next» печатается только у срочных — кто и куда ушло пишем в заголовок.
    void notifyCodeAdmins({
      marker: "done",
      title: `выдан из ${via} · ${actor}${delivered ? ` · ${delivered}` : ""}`,
      orderPublicId: result.publicId,
      denomination: order?.denomination ?? 0,
      amountKopecks: order?.finalAmountKopecks ?? 0,
      next: "",
    });
    return NextResponse.json({ ok: true, publicId: result.publicId, delivered });
  } catch (error) {
    console.error("[codes] admin issue failed", { order: parsed.data.publicId, error: (error as Error)?.message });
    return NextResponse.json({ ok: false, error: "Ошибка сервера" }, { status: 500 });
  }
}
