import { CheckCircle2 } from "lucide-react";
import css from "./order-timeline.module.css";

/**
 * 🎨 З6 (18.11.2026): шкала заказа сверху вниз — те же шаги, что в закрепе бота,
 * «пульс» на текущем. Места в очереди НЕТ (владелец: задержки по выдачам бывают).
 */
export default function OrderTimeline({ source, status, createdAt }: { source: string; status: string; createdAt: Date | string }) {
  const wb = source === "WB" || source === "WB_DBS";
  const steps = [
    wb ? "Код активирован" : "Оплата",
    "Геймпасс принят",
    "Выкуп",
    "Robux в Pending у Roblox",
  ];
  const current = ["AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(status) ? 0
    : status === "AWAITING_GAMEPASS" ? 1
    : ["PENDING", "IN_PROGRESS", "ERROR"].includes(status) ? 2
    : status === "COMPLETED" ? 3 : 0;
  const sub = (i: number): string | null => {
    if (i === 0 && current > 0) return new Date(createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
    if (i === current) {
      if (i === 1) return "ждём ваш геймпасс — инструкция по кнопке ниже";
      if (i === 2) return "заказ в очереди — обновится само";
      if (i === 3) return "с нашей стороны всё сделано, на баланс переводит Roblox";
      return "ждём оплату";
    }
    return null;
  };
  return (
    <ol className={css.list} aria-label="Ход заказа">
      {steps.map((label, i) => {
        const state = i < current ? css.done : i === current ? css.now : css.next;
        const note = sub(i);
        return (
          <li key={label} className={`${css.step} ${state}`} aria-current={i === current ? "step" : undefined}>
            <span className={css.rail} aria-hidden="true">
              <span className={css.dot}>{i < current ? <CheckCircle2 size={14} /> : null}</span>
              {i < steps.length - 1 && <span className={css.line} />}
            </span>
            <span className={css.body}>
              <span className={css.label}>{label}</span>
              {note && <span className={css.sub}>{note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
