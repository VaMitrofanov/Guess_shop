import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

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
        if (!credentials?.vk_id) return null;

        const vkId = credentials.vk_id as string;
        const name = credentials.name as string;
        const image = credentials.image as string;
        const wbCode = (credentials.wb_code as string)?.trim().toUpperCase();

        try {
          // Upsert user in DB
          let user = await prisma.user.findUnique({
            where: { vkId },
          });

          if (!user) {
            user = await prisma.user.create({
              data: {
                vkId,
                name,
                image,
                role: "USER",
                balance: 0,
              },
            });
          } else {
            // Update name/image if changed
            user = await prisma.user.update({
              where: { id: user.id },
              data: { name, image },
            });
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

          // Telegram notification
          try {
            const tgToken = process.env.TG_TOKEN;
            const tgChatIds = process.env.TG_CHAT_ID?.split(",").map((id) => id.trim()) ?? [];
            if (tgToken && tgChatIds.length > 0) {
              const isNew = !user || user.createdAt.getTime() === user.updatedAt.getTime();
              const msg =
                `${isNew ? "🆕 <b>Новый пользователь</b>" : "🔑 <b>Вход</b>"}\n` +
                `👤 ${name}\n` +
                `🆔 VK ID: <code>${vkId}</code>` +
                (wbCode && wbCode.length === 7 ? `\n🏷 WB код: <code>${wbCode}</code>` : "");
              await Promise.all(
                tgChatIds.map((chatId) =>
                  fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "HTML" }),
                  })
                )
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
          console.error("[auth] Database error during VK authorize:", dbErr);
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
  secret: process.env.NEXTAUTH_SECRET,
});
