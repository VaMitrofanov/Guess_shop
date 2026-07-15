export type CustomerOrderKind = "legacy" | "canonical";
export type CustomerOrderTone = "waiting" | "progress" | "success" | "danger" | "neutral";

export type CustomerOrderSnapshot = {
  id: string;
  kind: CustomerOrderKind;
  status: string;
  amountRobux: number;
  createdAt: Date;
};

export type CustomerOrderStatus = {
  label: string;
  tone: CustomerOrderTone;
  active: boolean;
  completed: boolean;
};

export type CustomerNotice = {
  id: string;
  title: string;
  text: string;
  tone: Exclude<CustomerOrderTone, "neutral">;
  orderId?: string;
};

const CANONICAL_STATUS: Record<string, CustomerOrderStatus> = {
  AWAITING_PAYMENT: { label: "Ожидает оплаты", tone: "waiting", active: true, completed: false },
  PAYMENT_PENDING: { label: "Проверяем оплату", tone: "waiting", active: true, completed: false },
  AWAITING_GAMEPASS: { label: "Нужен геймпасс", tone: "waiting", active: true, completed: false },
  PENDING: { label: "В очереди на выкуп", tone: "progress", active: true, completed: false },
  IN_PROGRESS: { label: "Выкупаем", tone: "progress", active: true, completed: false },
  COMPLETED: { label: "Выполнен", tone: "success", active: false, completed: true },
  REJECTED: { label: "Отклонён", tone: "danger", active: false, completed: false },
  ERROR: { label: "Нужна помощь", tone: "danger", active: false, completed: false },
};

const LEGACY_STATUS: Record<string, CustomerOrderStatus> = {
  PENDING: { label: "Ожидает оплаты", tone: "waiting", active: true, completed: false },
  PAID: { label: "Оплачен", tone: "progress", active: true, completed: false },
  FULFILLED: { label: "Выполнен", tone: "success", active: false, completed: true },
  FAILED: { label: "Ошибка", tone: "danger", active: false, completed: false },
};

export function customerOrderStatus(kind: CustomerOrderKind, status: string): CustomerOrderStatus {
  const known = (kind === "canonical" ? CANONICAL_STATUS : LEGACY_STATUS)[status];
  return known ?? { label: status, tone: "neutral", active: false, completed: false };
}

export function paymentAttemptLabel(status: string | null) {
  if (!status) return "Не создавался";
  const labels: Record<string, string> = {
    CREATED: "Готов к запуску",
    INITIATED: "Открыт в банке",
    AUTHORIZED: "Авторизован",
    CONFIRMED: "Оплата подтверждена",
    REJECTED: "Отклонён банком",
    CANCELED: "Отменён",
    FAILED: "Ошибка оплаты",
    PARTIALLY_REFUNDED: "Частично возвращён",
    REFUNDED: "Возвращён",
  };
  return labels[status] ?? status;
}

export function orderRecordLabel(count: number) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  const word = mod100 >= 11 && mod100 <= 14
    ? "записей"
    : mod10 === 1
      ? "запись"
      : mod10 >= 2 && mod10 <= 4
        ? "записи"
        : "записей";
  return `${count} ${word}`;
}

export function buildCustomerNotices({
  orders,
  balance,
  bonusExpiresAt,
  linkedProviders,
  now = new Date(),
}: {
  orders: CustomerOrderSnapshot[];
  balance: number;
  bonusExpiresAt: Date | null;
  linkedProviders: string[];
  now?: Date;
}): CustomerNotice[] {
  const notices: CustomerNotice[] = [];
  const latest = [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const order of latest) {
    if (order.kind === "canonical" && order.status === "AWAITING_GAMEPASS") {
      notices.push({ id: `gamepass:${order.id}`, orderId: order.id, tone: "waiting", title: "Нужен геймпасс", text: `Подготовь геймпасс для заказа на ${order.amountRobux} R$.` });
    } else if (["ERROR", "REJECTED", "FAILED"].includes(order.status)) {
      notices.push({ id: `problem:${order.id}`, orderId: order.id, tone: "danger", title: "Заказ требует внимания", text: `Проверь заказ на ${order.amountRobux} R$ или напиши менеджеру.` });
    } else if (customerOrderStatus(order.kind, order.status).active) {
      notices.push({ id: `active:${order.id}`, orderId: order.id, tone: "progress", title: customerOrderStatus(order.kind, order.status).label, text: `Заказ на ${order.amountRobux} R$ движется по очереди.` });
    }
    if (notices.length === 3) break;
  }

  if (balance > 0 && bonusExpiresAt) {
    const days = Math.ceil((bonusExpiresAt.getTime() - now.getTime()) / 86_400_000);
    if (days >= 0 && days <= 7) {
      notices.push({ id: "bonus-expiry", tone: "waiting", title: "Бонус скоро сгорит", text: `${balance} R$ доступны ещё ${days || 1} дн.` });
    }
  }

  if (!linkedProviders.includes("TG") || !linkedProviders.includes("VK")) {
    notices.push({ id: "identity", tone: "progress", title: "Защити историю заказов", text: "Связанные способы входа помогают не потерять заказы и бонусы." });
  }

  return notices.length > 0
    ? notices.slice(0, 4)
    : [{ id: "calm", tone: "success", title: "Всё спокойно", text: "Новых действий по заказам сейчас нет." }];
}
