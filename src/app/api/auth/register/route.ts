import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { RegisterSchema } from "@/lib/registration";
import {
  consentIpHash,
  PRIVACY_POLICY_VERSION,
  sendVerificationEmail,
} from "@/lib/email-account-lifecycle";
import { isMailerConfigured } from "@/lib/mailer";

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
    const verificationAvailable = isMailerConfigured();

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    if (existingUser) {
      // Registration is deliberately anti-enumeration: an existing address gets
      // the same response as a newly created account. If it is still unverified,
      // sending another verification link is safe and useful to the real owner.
      if (!existingUser.emailVerifiedAt && existingUser.email) {
        const delivery = await sendVerificationEmail(existingUser.id, existingUser.email);
        return NextResponse.json({ success: true, verificationAvailable, verificationSent: delivery.ok });
      }
      return NextResponse.json({ success: true, verificationAvailable, verificationSent: verificationAvailable });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const ipHash = consentIpHash(clientIp(req));

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
        },
      });
      await tx.consentEvidence.create({
        data: {
          userId: created.id,
          type: "PRIVACY_POLICY",
          documentVersion: PRIVACY_POLICY_VERSION,
          source: "WEB_REGISTRATION",
          ipHash,
        },
      });
      return created;
    });

    const delivery = await sendVerificationEmail(user.id, email);

    return NextResponse.json({
      success: true,
      verificationAvailable,
      verificationSent: delivery.ok,
    });

  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: true, verificationAvailable: isMailerConfigured() });
    }
    console.error("[registration] unable to complete request", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
