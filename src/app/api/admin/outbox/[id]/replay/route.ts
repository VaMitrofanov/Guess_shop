import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { OutboxReplayError, requestOutboxReplay } from "@/lib/outbox-replay";

export const dynamic = "force-dynamic";

const ReplaySchema = z.object({
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(3).max(300).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  if (!/^[a-z0-9_-]{8,40}$/i.test(id)) return NextResponse.json({ error: "Invalid outbox ID" }, { status: 400 });
  const parsed = ReplaySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Укажите причину и корректный ключ операции" }, { status: 400 });

  try {
    const result = await requestOutboxReplay({ outboxId: id, requestedBy: user.id, ...parsed.data });
    return NextResponse.json({ success: true, alreadyExists: result.kind === "existing", outbox: result.outbox }, { status: 202 });
  } catch (error) {
    if (error instanceof OutboxReplayError) {
      if (error.code === "OUTBOX_NOT_FOUND") return NextResponse.json({ error: "Сообщение outbox не найдено" }, { status: 404 });
      if (error.code === "OUTBOX_NOT_DEAD") return NextResponse.json({ error: "Повтор допустим только для DEAD-letter сообщений" }, { status: 409 });
      return NextResponse.json({ error: "Состояние сообщения уже изменилось; обновите страницу" }, { status: 409 });
    }
    console.error("[outbox-replay] failed", error);
    return NextResponse.json({ error: "Не удалось поставить повторную доставку в очередь" }, { status: 500 });
  }
}
