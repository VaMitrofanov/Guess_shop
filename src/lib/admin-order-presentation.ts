const ORDER_STATUS_LABELS: Readonly<Record<string, string>> = {
  AWAITING_PAYMENT: "Ждёт оплаты",
  PAYMENT_PENDING: "Платёж в работе",
  AWAITING_GAMEPASS: "Нужен геймпасс",
  PENDING: "В работе",
  IN_PROGRESS: "Выполняется",
  COMPLETED: "Выполнен",
  REJECTED: "Отклонён",
  ERROR: "Ошибка",
};

export function adminOrderStatusLabel(status: string) {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function adminRobloxUsername(value: string | null) {
  if (!value) return "Ник не указан";
  return value.startsWith("@") ? value : `@${value}`;
}
