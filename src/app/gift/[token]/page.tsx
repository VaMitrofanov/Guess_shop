import type { Metadata } from "next";
import Link from "next/link";
import { Caveat } from "next/font/google";
import { prisma } from "@/lib/prisma";
import { GIFT_THEME_META, hashGiftToken, isGiftTheme, isGiftTokenShape } from "@/lib/codes/gift";
import { giverEmail, thanksState } from "@/lib/codes/gift-share";
import GiftClient from "./gift-client";
import styles from "./gift.module.css";

export const dynamic = "force-dynamic";

/** Рукописный шрифт открытки (вариант В, 19.11.2026): пожелание, P.S., «тебе письмо». */
const hand = Caveat({ subsets: ["latin", "cyrillic"], weight: ["600", "700"], variable: "--font-hand" });

export const metadata: Metadata = {
  title: "Подарок — RobloxBank",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * 🎁 «Открыть подарок» по ссылке из письма-открытки (15.11.2026). До нажатия
 * кнопки видно только открытку: номинал, пожелание, от кого. Код — по кнопке
 * (`/api/codes/gift`, токен в теле запроса).
 */
function inFuture(date: Date | null): boolean {
  return Boolean(date && date.getTime() > Date.now());
}

export default async function GiftPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = isGiftTokenShape(token)
    ? await prisma.codeOrder.findUnique({
        where: { giftOpenTokenHash: hashGiftToken(token) },
        select: {
          id: true, denomination: true, status: true, giftTheme: true, giftTo: true, giftFrom: true, giftMessage: true, giftSendAt: true,
          creator: { select: { email: true, emailVerifiedAt: true } },
          payments: { where: { status: "CONFIRMED" }, select: { receiptEmail: true }, take: 1 },
        },
      })
    : null;

  if (!order || order.status === "REFUNDED") {
    return (
      <main className={styles.page}>
        <section className={styles.missing}>
          <h1>Подарок не найден</h1>
          <p>Проверьте, что ссылка открылась целиком. Если отправитель вернул подарок себе, ссылка больше не работает. Не получается — напишите нам, поможем.</p>
          <Link href="/" className={styles.homeLink}>На главную RobloxBank</Link>
        </section>
      </main>
    );
  }

  const theme = isGiftTheme(order.giftTheme) ? order.giftTheme : "JUST";
  const meta = GIFT_THEME_META[theme];
  const ready = order.status === "ISSUED" && !inFuture(order.giftSendAt);
  const thanked = await thanksState(order.id).catch(() => false);
  return (
    <div className={hand.variable}>
      <GiftClient
        token={token}
        ready={ready}
        theme={theme}
        greeting={meta.greeting(order.giftTo)}
        tagline={meta.tagline}
        denomination={order.denomination}
        message={order.giftMessage}
        from={order.giftFrom}
        to={order.giftTo}
        canThank={Boolean(giverEmail(order))}
        thanked={thanked}
      />
    </div>
  );
}
