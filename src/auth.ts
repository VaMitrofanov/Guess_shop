import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendTelegramMessage } from "@/lib/telegram";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
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
        };
      },
    }),
    CredentialsProvider({
      id: "vk-id",
      name: "VK ID",
      credentials: {
        vk_id: { label: "VK ID", type: "text" },
        name: { label: "Name", type: "text" },
        image: { label: "Image", type: "text" },
        wb_code: { label: "WB Code", type: "text" }, // Добавляем опциональный код зациты
      },
      async authorize(credentials) {
        console.log("[auth][vk-id] authorize() called", {
          hasVkId: !!credentials?.vk_id,
          hasWbCode: !!(credentials as any)?.wb_code,
        });

        if (!credentials?.vk_id) {
          console.warn("[auth][vk-id] no vk_id in credentials — abort");
          return null;
        }

        const vkId = credentials.vk_id as string;
        const name = credentials.name as string;
        const image = credentials.image as string;
        const wbCode = (credentials.wb_code as string)?.trim().toUpperCase();

        try {
          // Upsert user in DB
          let user;
          try {
            user = await prisma.user.findUnique({ where: { vkId } });
          } catch (findErr) {
            console.error("[auth][vk-id] prisma.user.findUnique failed — DB unreachable or schema mismatch:", findErr);
            throw findErr;
          }

          if (!user) {
            try {
              user = await prisma.user.create({
                data: { vkId, name, image, role: "USER", balance: 0 },
              });
              console.log(`[auth][vk-id] created new user id=${user.id} vkId=${vkId}`);
            } catch (createErr) {
              console.error("[auth][vk-id] prisma.user.create failed:", createErr);
              throw createErr;
            }
          } else {
            try {
              user = await prisma.user.update({
                where: { id: user.id },
                data: { name, image },
              });
            } catch (updErr) {
              console.error("[auth][vk-id] prisma.user.update failed:", updErr);
              throw updErr;
            }
          }

          // Link WB code if passed in credentials
          if (wbCode && wbCode.length === 7) {
            try {
              // Пытаемся привязать код к пользователю
              await (prisma as any).wbCode.update({
                where: { code: wbCode },
                data: { userId: user.id },
              });
              console.log(`[auth] Linked user ${user.id} to WbCode ${wbCode} via credentials`);
            } catch (linkErr) {
              console.error("[auth] Failed to link WbCode during authorize:", linkErr);
              // Не прерываем вход, если привязка кода не удалась (например, код уже использован)
            }
          }

          // Telegram notification — format depends on mode:
          //  • login mode (no wb_code): brief "🔑 Вход" card
          //  • order mode (wb_code present): full order card so admins know
          //    a code was linked via the site (bot may still send its own card
          //    when the gamepass URL arrives)
          try {
            const tgToken   = process.env.TG_TOKEN;
            const tgChatIds = process.env.TG_CHAT_ID?.split(",").map((id) => id.trim()) ?? [];
            if (tgToken && tgChatIds.length > 0) {
              let msg: string;
              if (wbCode && wbCode.length === 7) {
                // Order mode — full card
                const passPrice = Math.ceil(
                  // Look up denomination from DB; fall back to a rough estimate
                  (() => { try { return (user as any).wbCodes?.[0]?.denomination ?? 0; } catch { return 0; } })() / 0.7
                );
                msg =
                  `📦 <b>КОД АКТИВИРОВАН (сайт)</b>\n` +
                  `━━━━━━━━━━━━━━━━\n` +
                  `📱 Платформа: [WEB→VK]\n` +
                  `👤 Юзер: ${name}\n` +
                  `🆔 VK ID: <code>${vkId}</code>\n` +
                  `🔑 Код ВБ: <code>${wbCode}</code>\n` +
                  `📊 Статус: ⏳ Ожидает ссылку на геймпасс`;
              } else {
                // Login mode — brief card
                const isNew = user.createdAt.getTime() === user.updatedAt.getTime();
                msg =
                  `${isNew ? "🆕 <b>Новый пользователь</b>" : "🔑 <b>Вход</b>"}\n` +
                  `👤 ${name}\n` +
                  `🆔 VK ID: <code>${vkId}</code>`;
              }
              await Promise.all(
                tgChatIds.map((chatId) => sendTelegramMessage(tgToken, chatId, msg))
              );
            }
          } catch (tgErr) {
            console.error("[auth] Telegram notification failed:", tgErr);
          }

          return {
            id: user.id,
            name: user.name,
            image: user.image,
            role: user.role,
            wb_code: wbCode && wbCode.length === 7 ? wbCode : null,
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
        token.role = (user as any).role;
        token.vkId = (user as any).vkId;
        token.balance = (user as any).balance;
        token.wb_code = (user as any).wb_code ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).vkId = token.vkId;
        (session.user as any).balance = token.balance;
        (session.user as any).wb_code = token.wb_code ?? null;
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
