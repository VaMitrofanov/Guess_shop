"use client";

import { useEffect, useState } from "react";
import type { PaymentStatusTone } from "@/components/payment-methods";

/**
 * Правдивый статус приёма платежей для подвала (F2/F3, ultra-review 28.07).
 *
 * Почему клиентский, а не серверный: главная и другие публичные страницы
 * пререндерятся статически, поэтому серверное чтение `SITE_ACQUIRING_ENABLED`
 * запеклось бы в HTML на момент сборки. Kill switch же должен быть виден сразу
 * после перезапуска контейнера, без пересборки. `/api/acquiring/status` —
 * `force-dynamic` + `no-store`, поэтому один дешёвый запрос даёт актуальное
 * состояние.
 *
 * Пока ответа нет — не показываем ничего: пустой подвал честнее, чем мигающее
 * «платежи отключены» на работающем сайте.
 */
export default function PaymentStatusNotice({
  className = "mt-2.5 text-sm leading-relaxed text-[var(--rb-muted)]",
}: {
  className?: string;
}) {
  const [tone, setTone] = useState<PaymentStatusTone | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/acquiring/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setTone(data.accepting === false ? "closed" : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!tone) return null;
  return (
    <p className={className}>
      Приём платежей временно отключён до завершения проверки банка и кассы.
    </p>
  );
}
