import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

const db = prisma as unknown as PrismaClientWithWb;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code, device_id } = body;

    if (!code || !device_id) {
      return NextResponse.json({ error: "Missing code or device_id" }, { status: 400 });
    }

    const appId = process.env.NEXT_PUBLIC_VK_APP_ID;
    const clientSecret = process.env.VK_CLIENT_SECRET;

    if (!clientSecret) {
      console.error("[vk-callback] VK_CLIENT_SECRET is not configured");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    // 1. Exchange code for access_token on SERVER side
    const host = req.headers.get("host");
    const protocol = host?.includes("localhost") ? "http" : "https";
    const origin = `${protocol}://${host}`;
    const redirectUri = `${origin}/api/auth/callback/vk`;

    const exchangeUrl = "https://id.vk.com/oauth2/auth";
    const exchangeRes = await fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        device_id: device_id,
        client_id: appId || "",
        client_secret: clientSecret,
        state: "static_state",
        redirect_uri: redirectUri,
      }),
    });

    const exchangeData = await exchangeRes.json();

    if (exchangeData.error) {
      console.error("[vk-callback] Exchange error:", exchangeData);
      return NextResponse.json({ error: exchangeData.error_description || exchangeData.error }, { status: 401 });
    }

    const { access_token, user_id } = exchangeData;

    // 2. Fetch user info using SERVER-side token (bound to server IP)
    const vkRes = await fetch(
      `https://api.vk.com/method/users.get?user_ids=${user_id}&fields=photo_200&access_token=${access_token}&v=5.131`
    );
    const vkData = await vkRes.json();
    
    if (vkData.error) {
      console.error("[vk-callback] users.get error:", vkData.error);
      return NextResponse.json({ error: vkData.error.error_msg }, { status: 401 });
    }

    const vkUser = vkData.response?.[0];
    if (!vkUser) {
      return NextResponse.json({ error: "User not found from VK API" }, { status: 404 });
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
