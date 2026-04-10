import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// ─── VK Custom OAuth Provider ──────────────────────────────────────────────────

interface VKProfile {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

const VKProvider = {
  id: "vk",
  name: "VK",
  type: "oauth" as const,
  authorization: {
    url: "https://oauth.vk.com/authorize",
    params: {
      scope: "email",
      response_type: "code",
      v: "5.131",
      display: "mobile",
    },
  },
  token: "https://oauth.vk.com/access_token",
  userinfo: {
    request: async ({
      tokens,
    }: {
      tokens: Record<string, unknown>;
    }): Promise<VKProfile> => {
      const vkUserId = tokens.user_id;
      const email = tokens.email as string | null;

      const res = await fetch(
        `https://api.vk.com/method/users.get?user_ids=${vkUserId}&fields=photo_200&access_token=${tokens.access_token}&v=5.131`
      );
      const data = await res.json();
      const vkUser = data.response?.[0] ?? {};

      return {
        id: String(vkUserId),
        name: `${vkUser.first_name ?? ""} ${vkUser.last_name ?? ""}`.trim() || null,
        email: email ?? null,
        image: vkUser.photo_200 ?? null,
      };
    },
  },
  profile(profile: VKProfile) {
    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      image: profile.image,
    };
  },
  clientId: process.env.VK_CLIENT_ID!,
  clientSecret: process.env.VK_CLIENT_SECRET!,
};

// ─── Auth Options ──────────────────────────────────────────────────────────────

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Admin Login",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "admin@example.com" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.password) return null;

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        if (!isPasswordValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
    // next-auth v4 accepts any shape that satisfies the provider contract at runtime
    VKProvider as any,
  ],
  callbacks: {
    async jwt({ token, user, account }: { token: any; user?: any; account?: any }) {
      if (account?.provider === "vk" && user) {
        // Find or create VK user in DB.
        // Cast to `any` for vkId / image / balance until `prisma generate` is re-run
        // after the schema migration that adds these fields.
        const db = prisma as any;
        const vkId = String(user.id);
        let dbUser = await db.user.findUnique({ where: { vkId } });

        if (!dbUser) {
          dbUser = await db.user.create({
            data: {
              vkId,
              name: user.name ?? null,
              image: user.image ?? null,
            },
          });
        } else if (user.image && !dbUser.image) {
          dbUser = await db.user.update({
            where: { id: dbUser.id },
            data: { image: user.image, name: user.name ?? dbUser.name },
          });
        }

        token.id = dbUser.id;
        token.vkId = vkId;
        token.role = dbUser.role;
        token.balance = dbUser.balance ?? 0;
      }

      if (account?.provider === "credentials" && user) {
        token.id = user.id;
        token.role = (user as any).role;
      }

      return token;
    },

    async session({ session, token }: { session: any; token: any }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.vkId = token.vkId ?? null;
        session.user.balance = token.balance ?? 0;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60, // 30 дней
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
