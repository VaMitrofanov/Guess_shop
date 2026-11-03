import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendTelegramMessage, telegramAdminRecipients } from "@/lib/telegram";
import {
  placeHelpAdminText,
  recordPlaceHelp,
  shouldNotifyPlaceHelp,
  type PlaceHelpClient,
} from "../../../../../bots/shared/no-place-notice";
import { showsPlaceHelp } from "../../../../../bots/shared/no-place";

/**
 * На сайте ключ упёрся в «нет игры» — страница показала инструкцию по плейсу
 * (20.10.2026), а сюда шлёт сигнал для админов.
 *
 * Карточка админам («плейса нет») + событие заказа. Ответ покупателю не
 * зависит от исхода: шаги Studio страница показывает сама. Публичный роут,
 * поэтому: рейт-лимит, код и ник только по формату, карточка не чаще раза в
 * 30 минут на код (или адрес, если кода нет).
 */
const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = rateLimit(`wb-place-help:${ip}`, 3, 1 / 60);
  if (!limited.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const body = await request.json().catch(() => null);
  const rawCode = String(body?.code ?? "").trim().toUpperCase();
  const rawNick = String(body?.nick ?? "").trim().replace(/^@/, "");
  const code = /^[A-Z0-9]{7}$/.test(rawCode) ? rawCode : null;
  const nick = NICK_RE.test(rawNick) ? rawNick : null;
  const rawVerdict = String(body?.verdict ?? "");
  const verdict = showsPlaceHelp(rawVerdict) ? rawVerdict : "no_universe";

  let denomination: number | null = null;
  if (code) {
    const wb = await prisma.wbCode.findFirst({
      where: { code: { equals: code, mode: "insensitive" } },
      select: { denomination: true },
    }).catch(() => null);
    denomination = wb?.denomination ?? null;
  }
  const shown = { via: "site" as const, verdict, wbCode: code, denomination, nick, buyer: null };
  await recordPlaceHelp(prisma as unknown as PlaceHelpClient, shown);

  if (shouldNotifyPlaceHelp(`site:${code ?? ip}`)) {
    const token = process.env.TG_TOKEN ?? "";
    const text = placeHelpAdminText(shown);
    if (token) await Promise.allSettled(telegramAdminRecipients().map((id) => sendTelegramMessage(token, id, text)));
  }
  return NextResponse.json({ ok: true });
}
