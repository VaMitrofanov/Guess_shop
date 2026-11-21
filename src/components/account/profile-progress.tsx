import css from "./profile-progress.module.css";

type Step = { key: "TG" | "VK" | "MAIL"; label: string; done: boolean };

/**
 * 🎨 И5 (18.11.2026): «Профиль собран N/3» — Telegram, ВКонтакте, почта цепочкой.
 * Видно, чего не хватает; само действие — карточки ниже (Telegram, почта).
 */
export default function ProfileProgress({ tg, vk, mail }: { tg: boolean; vk: boolean; mail: boolean }) {
  const steps: Step[] = [
    { key: "TG", label: "Telegram", done: tg },
    { key: "VK", label: "ВКонтакте", done: vk },
    { key: "MAIL", label: "Почта", done: mail },
  ];
  const done = steps.filter((s) => s.done).length;
  const missing = steps.filter((s) => !s.done).map((s) => s.label.toLowerCase());
  const title = done === 3 ? "Профиль собран" : done === 2 ? "Профиль почти собран" : "Соберите профиль";
  const hint = done === 3
    ? "Все заказы в одном месте, статус — в Telegram"
    : `Осталось: ${missing.join(", ")}${!tg ? " — статус заказов придёт туда" : ""}`;
  return (
    <div className={css.wrap}>
      <div className={css.head}>
        <div className={css.ring} style={{ ["--p" as string]: String(Math.round((done / 3) * 100)) }} role="img" aria-label={`Собрано ${done} из 3`}>
          <b>{done}/3</b>
        </div>
        <div>
          <p className={css.title}>{title}</p>
          <p className={css.hint}>{hint}</p>
        </div>
      </div>
      <div className={css.chain}>
        {steps.map((s, i) => (
          <div key={s.key} style={{ display: "contents" }}>
            {i > 0 && <span className={`${css.link} ${s.done && steps[i - 1].done ? "" : css.linkOff}`} aria-hidden="true" />}
            <div className={`${css.node} ${s.done ? css.on : css.offNode}`}>
              <span className={`${css.badge} ${s.done ? css[s.key === "TG" ? "tg" : s.key === "VK" ? "vk" : "mail"] : css.off}`} aria-hidden="true">
                {s.key === "TG" ? "TG" : s.key === "VK" ? "VK" : "@"}
              </span>
              <span className={css.state}>{s.label}<br />{s.done ? "подключён" : "добавить"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
