import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import styles from "@/app/legal/legal.module.css";

/**
 * Общая рамка юридических страниц (оферта, политика, реквизиты).
 *
 * Почему один компонент: у всех документов одинаковая шапка, акцентная линия,
 * дата обновления и типографика. Правку от юриста применяем один раз, а не в
 * каждом документе.
 *
 * Оформление живёт в `legal.module.css` на токенах `--rb-*`. До 28.07.2026
 * здесь был старый тёмный макет с захардкоженными `#080c18`/`#00b06f` и
 * шейдерной подложкой: после перевода публичного шелла на Violet/Frost шапка
 * и подвал стали светлыми, а тело документа осталось тёмным — на светлой теме
 * страница выглядела сломанной.
 *
 * Дети — обычная семантическая разметка (`<section>`, `<h2>`, `<p>`, `<ol>`).
 */
export function LegalDocument({
  badge = "Legal Document",
  title,
  subtitle,
  lastUpdated,
  children,
}: {
  badge?: string;
  title: React.ReactNode;
  subtitle?: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.page}>
      <Navbar />

      <article className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.badge}>{badge}</div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          <p className={styles.updated}>Последнее обновление: {lastUpdated}</p>
        </header>

        <div className={styles.rule} />

        <div className={styles.body}>{children}</div>

        <p className={styles.note}>
          Используя сервис Roblox Bank, вы подтверждаете согласие с настоящим документом.
        </p>
      </article>

      <Footer />
    </main>
  );
}

/** Нумерованный заголовок раздела: «01 Общие положения». */
export function SectionTitle({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <h2>
      <span>{number}</span>
      <span>{children}</span>
    </h2>
  );
}
