import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendTelegramMessage } from "@/lib/telegram";
import { verifyVkIdUser } from "@/lib/vk-id";
import { findOrCreateVerifiedIdentity } from "@/lib/user-identity";
import { verifyTelegramLogin } from "@/lib/telegram-login";
import { normalizeLoginEmail } from "@/lib/auth-navigation";
import { allowPasswordSignIn } from "@/lib/auth-throttle";
import { clientIp } from "@/lib/rate-limit";
import { consumeTelegramWebLoginChallenge } from "@/lib/telegram-web-login";
import { adminGrantFor, loadAdminCandidate } from "@/lib/admin-grant";
import { resolveWbOrderSource } from "../bots/shared/wb-order-source";
import { noteDbsBuyerSignedIn } from "../bots/shared/wb-dbs-thread";

// VK display names are user-controlled and embedded into Telegram HTML
// notifications — unescaped "<" breaks the whole message (silently lost).
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const recentLoginNotifs = new Map<string, number>();
const LOGIN_NOTIF_DEDUP_MS = 5 * 60 * 1000;
function shouldSendLoginNotif(vkId: string): boolean {
  const now = Date.now();
  const last = recentLoginNotifs.get(vkId);
  if (last && now - last < LOGIN_NOTIF_DEDUP_MS) return false;
  recentLoginNotifs.set(vkId, now);
  if (recentLoginNotifs.size > 500) {
    for (const [k, t] of recentLoginNotifs) {
      if (now - t > LOGIN_NOTIF_DEDUP_MS) recentLoginNotifs.delete(k);
    }
  }
  return true;
}

// ── Startup-time env validation ────────────────────────────────────────────
// NextAuth produces a generic "Server error - Configuration" page when
// required env vars are missing. Logging at module init makes the root
// cause obvious in Coolify/Vercel runtime logs.
(() => {
  // NextAuth v5 (Auth.js) prefers AUTH_SECRET, but we also accept the
  // legacy NEXTAUTH_SECRET name for backwards compatibility with Vercel/Coolify
  // environments that were already configured for v4.
  const hasSecret = !!(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);
  const hasUrl = !!(process.env.AUTH_URL || process.env.NEXTAUTH_URL);
  const hasDb = !!process.env.DATABASE_URL;

  const missing: string[] = [];
  if (!hasSecret) missing.push("AUTH_SECRET (or NEXTAUTH_SECRET)");
  if (!hasUrl) missing.push("AUTH_URL (or NEXTAUTH_URL)");
  if (!hasDb) missing.push("DATABASE_URL");

  if (missing.length > 0) {
    console.error(
      `[auth][startup] MISSING REQUIRED ENV: ${missing.join(", ")}. ` +
        `NextAuth will return Configuration error until set in deploy env.`
    );
  } else {
    console.log("[auth][startup] all required env vars present");
  }
  const optional = ["TG_TOKEN", "TG_CHAT_ID", "NEXT_PUBLIC_VK_APP_ID", "VK_TOKEN", "VK_GROUP_ID"];
  const missingOpt = optional.filter((k) => !process.env[k]);
  if (missingOpt.length > 0) {
    console.warn(`[auth][startup] missing optional env: ${missingOpt.join(", ")}`);
  }
})();

/**
 * Роль сессии выводится, а не хранится (этап A1).
 *
 * Админом делает проверенная Telegram-личность в `ADMIN_IDS` либо запасной вход
 * владельца — правило целиком в `adminGrantFor`. Всё остальное — `USER`, даже
 * если в базе почему-то стоит `role = "ADMIN"`: одной записи в БД для админки
 * теперь недостаточно.
 *
 * Если запрос к базе не удался, роль намеренно понижается до `USER`
 * (fail-closed): временная недоступность БД не должна открывать админку.
 */
async function deriveSessionRole(userId: string, fallbackRole?: string): Promise<string> {
  try {
    const candidate = await loadAdminCandidate(userId);
    if (!candidate) return "USER";
    return adminGrantFor(candidate) ? "ADMIN" : "USER";
  } catch (error) {
    console.error("[auth] deriveSessionRole failed, понижаем до USER", { userId, error });
    return fallbackRole === "ADMIN" ? "USER" : (fallbackRole ?? "USER");
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      id: "admin-login",
      name: "Admin Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = normalizeLoginEmail(String(credentials.email));

        // Throttle before touching the database or bcrypt. A throttled attempt
        // returns the same null as a wrong password, so the limiter itself
        // reveals nothing about whether the account exists.
        if (!allowPasswordSignIn(email, clientIp(request))) {
          console.warn("[auth][password] sign-in throttled");
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.password) return null;

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );
        if (!isPasswordValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    CredentialsProvider({
      id: "telegram-login",
      name: "Telegram",
      credentials: {
        id: { label: "Telegram ID", type: "text" },
        first_name: { label: "First name", type: "text" },
        last_name: { label: "Last name", type: "text" },
        username: { label: "Username", type: "text" },
        photo_url: { label: "Photo", type: "text" },
        auth_date: { label: "Auth date", type: "text" },
        hash: { label: "Hash", type: "text" },
        state: { label: "One-time state", type: "text" },
      },
      async authorize(credentials) {
        const verified = verifyTelegramLogin({
          id: String(credentials?.id ?? ""),
          first_name: String(credentials?.first_name ?? ""),
          last_name: credentials?.last_name ? String(credentials.last_name) : undefined,
          username: credentials?.username ? String(credentials.username) : undefined,
          photo_url: credentials?.photo_url ? String(credentials.photo_url) : undefined,
          auth_date: String(credentials?.auth_date ?? ""),
          hash: String(credentials?.hash ?? ""),
        });
        if (!verified) return null;
        const challenge = await consumeTelegramWebLoginChallenge(String(credentials?.state ?? ""), "login");
        if (!challenge) return null;
        const user = await findOrCreateVerifiedIdentity({
          provider: "TG",
          subject: verified.subject,
          name: verified.name,
          image: verified.image,
        });
        if (verified.username && user.username !== verified.username) {
          return prisma.user.update({ where: { id: user.id }, data: { username: verified.username } });
        }
        return user;
      },
    }),
    CredentialsProvider({
      id: "vk-id",
      name: "VK ID",
      credentials: {
        // Raw tokens from VKID.Auth.exchangeCode() — identity is resolved
        // server-side via VK (see src/lib/vk-id.ts). Client-supplied
        // vk_id/name are no longer accepted (risk #5, docs/security.md).
        access_token: { label: "Access Token", type: "text" },
        id_token: { label: "ID Token", type: "text" },
        wb_code: { label: "WB Code", type: "text" }, // опциональный код защиты
      },
      async authorize(credentials) {
        console.log("[auth][vk-id] authorize() called", {
          hasAccessToken: !!credentials?.access_token,
          hasIdToken: !!credentials?.id_token,
          hasWbCode: !!(credentials as any)?.wb_code,
        });

        const verified = await verifyVkIdUser(
          (credentials?.access_token as string) ?? "",
          (credentials?.id_token as string) ?? ""
        );
        if (!verified) {
          console.warn("[auth][vk-id] VK rejected the token(s) — abort");
          return null;
        }

        const vkId = verified.vkId;
        const name = verified.name || "VK User";
        const image = verified.avatar;
        const rawWbCode = (credentials.wb_code as string)?.trim().toUpperCase() ?? "";
        // Strip guide-mode prefix ("GD" + 7-char code = 9 chars total)
        const wbCode = rawWbCode.startsWith("GD") && rawWbCode.length === 9
          ? rawWbCode.slice(2)
          : rawWbCode;
        const isGuideMode = rawWbCode.startsWith("GD") && rawWbCode.length === 9;

        try {
          // Resolve the server-verified VK subject through UserIdentity. It
          // first finds legacy vkId users, so existing bot customers retain
          // their original User, orders and bonus balance on web sign-in.
          let user;
          try {
            user = await findOrCreateVerifiedIdentity({
              provider: "VK",
              subject: vkId,
              name: verified.name || undefined,
              image: image || undefined,
            });
          } catch (findErr) {
            console.error("[auth][vk-id] identity resolution failed — DB unreachable, migration missing, or conflicting identity:", findErr);
            throw findErr;
          }

          // Link WB code if passed in credentials (works for both regular and guide mode
          // after the GD prefix has been stripped above)
          let wbCodeRecord: any = null;
          // U8: раньше P2025 («код уже CLAIMED») ловился, логировался — и
          // выполнение шло дальше: `provisionalOrder` подхватывал ЧУЖОЙ заказ,
          // а `wb_code` всё равно клался в сессию. Пользователь уходил в
          // коридор с ощущением успешной активации чужого кода. Теперь
          // различаем «код наш» и «код занят другим аккаунтом».
          let wbCodeClaimedByOther = false;
          if (wbCode && wbCode.length === 7) {
            try {
              wbCodeRecord = await (prisma as any).wbCode.findUnique({ where: { code: wbCode } });
              if (wbCodeRecord) {
                if (wbCodeRecord.status === "CLAIMED" && wbCodeRecord.userId && wbCodeRecord.userId !== user.id) {
                  wbCodeClaimedByOther = true;
                } else {
                  await (prisma as any).wbCode.update({
                    where: { code: wbCode, status: { not: "CLAIMED" } },
                    data: { userId: user.id, status: "CLAIMED", isUsed: false },
                  });
                  console.log(`[auth] Linked user ${user.id} to WbCode ${wbCode} via credentials (guideMode=${isGuideMode})`);
                }
              }
            } catch (linkErr: any) {
              // P2025 = запись под условие не найдена, то есть код перехватили
              // между чтением и записью. Это тот же исход «занят другим».
              if (linkErr?.code === "P2025") {
                wbCodeClaimedByOther = true;
              }
              console.error("[auth] Failed to link WbCode during authorize:", linkErr);
            }
          }

          if (wbCodeClaimedByOther) {
            // Сигнал админам: чужая активация кода — это ещё и индикатор
            // ПВЗ-фрода (риск №15 в docs/security.md).
            console.warn(`[auth] wb-code ${wbCode} already claimed by another account — login blocked for ${user.id}`);
            try {
              const tgToken = process.env.TG_TOKEN;
              const chatIds = (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
                .split(",").map((id) => id.trim()).filter(Boolean);
              await Promise.allSettled(chatIds.map((chatId) =>
                fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: `⚠️ Код ${wbCode} пытались активировать вторым аккаунтом (VK-вход). Возможен вскрытый на ПВЗ код — проверьте.`,
                  }),
                })
              ));
            } catch { /* уведомление не должно ломать вход */ }
          }

          // ── Provisional order + admin card (VK code activation) ─────────
          // Create the provisional order here so admin sees a full card
          // immediately. The VK bot's handleRefActivation checks for existing
          // orders and skips creation if one already exists.
          //
          // A DBS buyer reaches the gate from the WB chat link, so this login
          // usually wins the race against the bot — which means `orderSource`
          // has to be resolved HERE too. Without it the order silently kept the
          // schema default `WB` and the admin card lost the DBS origin (order
          // 5508907054 / code ZM4XAW3, 16.08).
          let provisionalOrder: any = null;
          if (wbCode && wbCode.length === 7 && wbCodeRecord && !wbCodeClaimedByOther) {
            try {
              const existing = await prisma.wbOrder.findUnique({ where: { wbCode } });
              if (!existing) {
                provisionalOrder = await prisma.wbOrder.create({
                  data: {
                    amount: wbCodeRecord.denomination,
                    gamepassUrl: null,
                    status: "AWAITING_GAMEPASS",
                    platform: "VK",
                    userId: user.id,
                    wbCode,
                    orderSource: await resolveWbOrderSource(prisma, wbCode),
                  } as any,
                });
              } else {
                provisionalOrder = existing;
              }
            } catch (orderErr) {
              console.error("[auth] Provisional order creation failed:", orderErr);
            }
          }

          // Telegram notification — proper order card for code activation,
          // brief sign-in card for login without code.
          try {
            const tgToken   = process.env.TG_TOKEN;
            const tgChatIds = [...new Set(
              process.env.TG_CHAT_ID?.split(",").map((id) => id.trim()).filter(Boolean) ?? [],
            )];
            if (tgToken && tgChatIds.length > 0) {
              let msg: string | null = null;
              let reply_markup: unknown = undefined;
              // Send the order card ONLY for a genuinely active activation:
              // the code exists and the order is still awaiting a gamepass.
              // Re-logins with a stale wb_code cookie (order already PENDING/
              // COMPLETED) and typo'd codes fall through to the plain
              // sign-in card — previously they produced a misleading
              // «ЗАКАЗ … Ожидаем ссылку» (or «ЗАКАЗ #—») card.
              const isActiveActivation =
                wbCode && wbCode.length === 7 && !!wbCodeRecord &&
                !!provisionalOrder && provisionalOrder.status === "AWAITING_GAMEPASS";
              // DBS-заказ уже ведёт живую карточку в админке. Вход на сайт для
              // него — шаг воронки, а не задача: он уходит строкой в таймлайн
              // той же карточки, и третьего сообщения об одном заказе больше
              // нет (скрин владельца, 01.09.2026).
              const foldedIntoDbsCard = isActiveActivation
                ? await noteDbsBuyerSignedIn(prisma, wbCode!, "VK").catch(() => false)
                : false;
              if (isActiveActivation && !foldedIntoDbsCard) {
                const denomination = wbCodeRecord?.denomination ?? 0;
                const passPrice    = denomination > 0 ? Math.ceil(denomination / 0.7) : null;
                const dateStr = new Date().toLocaleString("ru-RU", {
                  timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
                  year: "numeric", hour: "2-digit", minute: "2-digit",
                }) + " МСК";
                // Заголовок = код ВБ (номера заказов убраны — C2, 2026-07-03).
                msg =
                  `📦 <b>ЗАКАЗ <code>${wbCode}</code></b>\n` +
                  `━━━━━━━━━━━━━━━━\n` +
                  (isGuideMode ? `📖 Режим: <b>Инструкция</b>\n` : ``) +
                  `📘 Источник: <b>VK (сайт)</b>\n` +
                  `📅 Время: <b>${dateStr}</b>\n` +
                  `👤 Юзер: <a href="https://vk.com/id${vkId}">${escapeHtml(name)}</a>\n` +
                  (denomination > 0 ? `💎 Сумма: <b>${denomination} R$</b>${passPrice ? ` (Геймпасс: ${passPrice} R$)` : ""}\n` : ``) +
                  `📊 Статус: ⌛ Ожидаем ссылку на геймпасс`;
                const twaUrl = `https://robloxbank.ru/twa?q=${encodeURIComponent(wbCode!)}`;
                reply_markup = {
                  inline_keyboard: [
                    [{ text: "📊 Открыть в дашборде", web_app: { url: twaUrl } }],
                  ],
                };
              } else if (shouldSendLoginNotif(vkId)) {
                const isNew = user.createdAt.getTime() === user.updatedAt.getTime();
                msg =
                  `${isNew ? "🆕 <b>Новый пользователь</b>" : "🔑 <b>Вход</b>"}\n` +
                  `👤 ${escapeHtml(name)}\n` +
                  `🆔 VK ID: <code>${vkId}</code>`;
              }
              if (msg) {
                await Promise.all(
                  tgChatIds.map((chatId) => sendTelegramMessage(tgToken, chatId, msg!, reply_markup ? { reply_markup } : undefined))
                );
              }
            }
          } catch (tgErr) {
            console.error("[auth] Telegram notification failed:", tgErr);
          }

          return {
            id: user.id,
            name: user.name,
            image: user.image,
            role: user.role,
            sessionVersion: user.sessionVersion,
            // U8: занятый чужим аккаунтом код в сессию не кладём — иначе
            // клиент уходит в коридор по чужому заказу.
            wb_code: wbCode && wbCode.length === 7 && !wbCodeClaimedByOther ? wbCode : null,
            wb_code_conflict: wbCodeClaimedByOther || undefined,
            is_guide_mode: isGuideMode,
          };
        } catch (dbErr) {
          console.error("[auth][vk-id] FATAL — authorize() threw:", {
            message: (dbErr as Error)?.message,
            code: (dbErr as any)?.code,
            stack: (dbErr as Error)?.stack,
          });
          // Return null so NextAuth shows a clean failure page instead of
          // bubbling Configuration error. The root cause is now in the logs.
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = await deriveSessionRole(user.id!, (user as any).role);
        token.vkId = (user as any).vkId;
        token.balance = (user as any).balance;
        token.auth_time = Math.floor(Date.now() / 1000);
        token.wb_code = (user as any).wb_code ?? null;
        // U8: код занят другим аккаунтом — коридор покажет экран поддержки,
        // а не «успешную активацию».
        token.wb_code_conflict = (user as any).wb_code_conflict ?? false;
        token.is_guide_mode = (user as any).is_guide_mode ?? false;
        token.sessionVersion = (user as any).sessionVersion ?? 0;
        token.invalidated = false;
      } else if (token.id) {
        // Tokens issued before sessionVersion existed cannot be revoked safely:
        // accepting them would leave a pre-reset session alive forever. Invalidate
        // that small legacy cohort once at rollout; every fresh login gets the
        // current version and remains active until an explicit password reset.
        if (typeof token.sessionVersion !== "number") {
          token.invalidated = true;
        } else {
          const current = await prisma.user.findUnique({
            where: { id: String(token.id) },
            select: { sessionVersion: true },
          });
          if (!current || current.sessionVersion !== token.sessionVersion) token.invalidated = true;
        }
        // A0.2 (этап A1): раньше `role` записывалась в токен один раз при входе
        // и больше не сверялась, поэтому снятие админа не действовало до
        // перелогина. Теперь роль выводится заново на каждом обновлении токена
        // — рядом с уже выполняемым запросом за `sessionVersion`.
        if (!token.invalidated) {
          token.role = await deriveSessionRole(String(token.id), token.role as string | undefined);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.invalidated) {
        (session as any).user = undefined;
        return session;
      }
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).vkId = token.vkId;
        (session.user as any).balance = token.balance;
        (session.user as any).auth_time = token.auth_time;
        (session.user as any).wb_code = token.wb_code ?? null;
        (session.user as any).wb_code_conflict = token.wb_code_conflict ?? false;
        (session.user as any).is_guide_mode = token.is_guide_mode ?? false;
      }
      return session;
    },
  },
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  // Trust the X-Forwarded-Host header — required when running behind any
  // reverse proxy (Coolify/Traefik, Vercel, Cloudflare Tunnel). Without
  // this, NextAuth v5 rejects the request and renders the generic
  // "Server error - There is a problem with the server configuration"
  // page seen in production.
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});
