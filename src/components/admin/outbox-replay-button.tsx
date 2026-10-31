"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import styles from "@/components/admin/admin-shell.module.css";

export default function OutboxReplayButton({ outboxId }: { outboxId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function replay() {
    const reason = window.prompt("Почему доставка повторяется? Причина сохранится в журнале (3–300 символов).");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setState("error");
      return;
    }
    if (!window.confirm("Повторить только доставку уведомления? Платёж и возврат не будут затронуты.")) return;

    setState("sending");
    try {
      const response = await fetch(`/api/admin/outbox/${encodeURIComponent(outboxId)}/replay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), reason: reason.trim() }),
      });
      if (!response.ok) throw new Error("request failed");
      setState("done");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
      <button className={styles.secondaryButton} type="button" onClick={replay} disabled={state === "sending" || state === "done"}>
        <RotateCcw size={14} /> {state === "sending" ? "Ставим в очередь…" : state === "done" ? "Повтор поставлен" : "Повторить доставку"}
      </button>
      {state === "error" && <small style={{ color: "#ff9aa1" }}>Не удалось. Обновите страницу и проверьте статус.</small>}
    </span>
  );
}
