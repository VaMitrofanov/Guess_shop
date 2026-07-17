import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { RegisterSchema } from "@/lib/registration";

export async function POST(req: NextRequest) {
  const { ok, retryAfter } = rateLimit(`register:${clientIp(req)}`, 5, 0.1);
  if (!ok) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позже." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  try {
    const body = await req.json();
    const validated = RegisterSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json({ error: "Invalid data", details: validated.error.issues }, { status: 400 });
    }

    const { password, name } = validated.data;
    const email = validated.data.email.trim().toLowerCase();

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: "Email already in use" }, { status: 400 });
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 3. Create user (role defaults to USER in schema)
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
        },
      });
      await tx.userIdentity.create({
        data: { provider: "EMAIL", subject: email, userId: created.id },
      });
      return created;
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });

  } catch (error) {
    console.error("Registration Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
