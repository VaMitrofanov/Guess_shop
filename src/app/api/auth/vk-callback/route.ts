import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

const db = prisma as unknown as PrismaClientWithWb;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { access_token, user_id } = body;

    if (!access_token || !user_id) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    // Optional: Verify token with VK API to be 100% sure
    // https://api.vk.com/method/users.get?user_ids=USER_ID&fields=photo_200&access_token=TOKEN&v=5.131
    const vkRes = await fetch(
      `https://api.vk.com/method/users.get?user_ids=${user_id}&fields=photo_200&access_token=${access_token}&v=5.131`
    );
    const vkData = await vkRes.json();
    
    if (vkData.error) {
      return NextResponse.json({ error: vkData.error.error_msg }, { status: 401 });
    }

    const vkUser = vkData.response?.[0];
    if (!vkUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const name = `${vkUser.first_name} ${vkUser.last_name}`.trim();
    const image = vkUser.photo_200;

    // Login via Auth.js v5 server-side
    // We use the "vk-id" credentials provider
    const result = await signIn("vk-id", {
      vk_id: String(user_id),
      name,
      image,
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
