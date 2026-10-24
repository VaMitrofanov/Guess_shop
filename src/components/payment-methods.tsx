/**
 * F2 (ultra-review 28.07): раньше это был булев `showStatus`, который в подвале
 * стоял без условия — текст «приём платежей отключён» висел на каждой странице
 * и не изменился бы после открытия сайта. Теперь состояние называется своим
 * именем, а «всё работает» — это отсутствие баннера, а не отдельный текст.
 */
export type PaymentStatusTone = "limited" | "closed";

type PaymentMethodsProps = {
  className?: string;
  /** Не передан — баннера нет (обычный рабочий режим). */
  statusTone?: PaymentStatusTone;
};

const STATUS_TEXT: Record<PaymentStatusTone, string> = {
  closed: "Приём платежей временно отключён до завершения проверки банка и кассы.",
  limited: "Идёт поэтапный запуск: оплата пока открыта части клиентов.",
};

const brandClass = "inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--rb-border)] bg-[var(--rb-surface)] px-3 py-2 text-[var(--rb-text)]";

export default function PaymentMethods({ className = "", statusTone }: PaymentMethodsProps) {
  return (
    <section className={className} aria-label="Платёжный партнёр и поддерживаемые платёжные системы">
      <div className="flex flex-wrap items-center gap-2.5" role="list">
        <span className={brandClass} role="listitem" aria-label="Т-Банк">
          <svg viewBox="0 0 102 28" className="h-6 w-[88px]" role="img" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="#FFDD2D" />
            <path d="M7 7.5h14v4.1c-1.55-1.65-3.85-2.6-7-2.6s-5.45.95-7 2.6V7.5Zm5.1 3.8h3.8v9.25c1.65.28 2.9.88 3.75 1.95H8.35c.85-1.07 2.1-1.67 3.75-1.95V11.3Z" fill="#111" />
            <text x="36" y="19" fill="currentColor" fontSize="15" fontWeight="800" fontFamily="Arial, sans-serif">Т-Банк</text>
          </svg>
        </span>
        <span className={brandClass} role="listitem" aria-label="Платёжная система Мир">
          <svg viewBox="0 0 72 25" className="h-5 w-[64px]" role="img" aria-hidden="true">
            <text x="1" y="19" fill="#159E72" fontSize="22" fontWeight="900" fontStyle="italic" fontFamily="Arial, sans-serif">МИР</text>
            <path d="M52 5h17l-4 6H48l4-6Z" fill="#3CB4E5" />
          </svg>
        </span>
        <span className={brandClass} role="listitem" aria-label="Visa">
          <svg viewBox="0 0 65 22" className="h-5 w-[60px]" role="img" aria-hidden="true">
            <text x="1" y="18" fill="#1434CB" fontSize="21" fontWeight="900" fontStyle="italic" fontFamily="Arial, sans-serif">VISA</text>
          </svg>
        </span>
        <span className={brandClass} role="listitem" aria-label="Mastercard">
          <svg viewBox="0 0 72 28" className="h-6 w-[62px]" role="img" aria-hidden="true">
            <circle cx="27" cy="14" r="11" fill="#EB001B" />
            <circle cx="41" cy="14" r="11" fill="#F79E1B" fillOpacity=".94" />
          </svg>
        </span>
        <span className={brandClass} role="listitem" aria-label="Система быстрых платежей">
          <svg viewBox="0 0 86 28" className="h-6 w-[76px]" role="img" aria-hidden="true">
            <path d="m8 3 8 7-5 4 5 4-8 7-3-3 6-5-6-5 3-9Z" fill="#00B7A9" />
            <path d="m16 10 5-4 4 4-5 4-4-4Z" fill="#8A5BD7" />
            <text x="30" y="19" fill="currentColor" fontSize="15" fontWeight="850" fontFamily="Arial, sans-serif">СБП</text>
          </svg>
        </span>
      </div>
      {statusTone && (
        <p className="mt-2.5 text-sm leading-relaxed text-[var(--rb-muted)]">
          {STATUS_TEXT[statusTone]}
        </p>
      )}
    </section>
  );
}
