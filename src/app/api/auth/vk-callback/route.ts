import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

const db = prisma as unknown as PrismaClientWithWb;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { user_id, name, image } = body;

    if (!user_id || !name) {
      return NextResponse.json({ error: "Missing user data" }, { status: 400 });
    }

    // Login via Auth.js v5 server-side
    // We use the "vk-id" credentials provider
    const result = await signIn("vk-id", {
      vk_id: String(user_id),
      name,
      image: image || "",
    });
    const user = (result as any)?.user;

    // WB Linking Logic
    const cookieStore = await cookies();
    const wbCode = cookieStore.get("wb_code")?.value?.trim().toUpperCase();

    if (wbCode && wbCode.length === 7 && user?.id) {
      try {
        await db.wbCode.update({
          where: { code: wbCode },
          data: { userId: user.id },
        });
        console.log(`[vk-callback] Linked user ${user.id} to WbCode ${wbCode}`);
      } catch (err) {
        console.error("[vk-callback] Failed to link WbCode:", err);
      }
    }

    return NextResponse.json({ 
      success: true, 
      user: { name, image },
      redirectUrl: wbCode ? `https://vk.me/bankroblox?ref=${wbCode}` : "/dashboard"
    });
  } catch (error: any) {
    console.error("VK Callback Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
