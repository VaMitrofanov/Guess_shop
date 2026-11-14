import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CircleCheck } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { LANDINGS, landingBySlug } from "@/lib/seo/landings";
import { CODE_DENOMINATIONS, CODE_PRICES } from "@/lib/codes-pricing";
import { directPrice } from "@/lib/retail-pricing";
import styles from "./landing.module.css";

/**
 * 🔎 Посадочная страница под поисковый запрос (15.11.2026). Тексты —
 * `src/lib/seo/landings.ts`, цены — из прайса. Каждая страница — своя папка
 * `src/app/<slug>/page.tsx` (статичный адрес, без перехвата верхнего уровня).
 */
export function landingMetadata(slug: string): Metadata {
  const landing = landingBySlug(slug);
  if (!landing) return {};
  return {
    title: landing.title,
    description: landing.description,
    alternates: { canonical: `/${landing.slug}` },
    openGraph: { title: landing.title, description: landing.description, url: `/${landing.slug}`, locale: "ru_RU", type: "article" },
  };
}

const GAMEPASS_AMOUNTS = [500, 1000, 2000, 5000];

export default function LandingPage({ slug }: { slug: string }) {
  const landing = landingBySlug(slug);
  if (!landing) notFound();
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: landing.faq.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
  };
  const others = LANDINGS.filter((item) => item.slug !== landing.slug);
  return (
    <main className={styles.page}>
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }} />
      <article className={styles.shell}>
        <header className={styles.hero}>
          <span className={styles.kicker}>RobloxBank · Robux за рубли</span>
          <h1>{landing.h1}</h1>
          <p className={styles.lead}>{landing.lead}</p>
          <Link href={landing.cta.href} className={styles.cta}>{landing.cta.label} <ArrowRight size={18} /></Link>
        </header>

        <section className={styles.prices} aria-labelledby="prices-title">
          <h2 id="prices-title">Цены на коды Roblox</h2>
          <div className={styles.priceGrid}>
            {CODE_DENOMINATIONS.map((denomination) => (
              <Link key={denomination} href={`/?pack=${denomination}#codes`} className={styles.price}>
                <b>{denomination.toLocaleString("ru-RU")}</b>
                <span>Robux</span>
                <small>{CODE_PRICES[denomination].toLocaleString("ru-RU")} ₽</small>
              </Link>
            ))}
          </div>
          {landing.showPrices === "both" && (
            <p className={styles.passPrices}>
              Через геймпасс: {GAMEPASS_AMOUNTS.map((amount) => `${amount.toLocaleString("ru-RU")} R$ — ${directPrice(amount).toLocaleString("ru-RU")} ₽`).join(" · ")}. Дешевле, но Robux приходят не сразу.
            </p>
          )}
        </section>

        {landing.sections.map((section) => (
          <section key={section.h2} className={styles.section}>
            <h2>{section.h2}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph.slice(0, 40)}>{paragraph}</p>)}
            {section.steps && (
              <ol className={styles.steps}>
                {section.steps.map((step) => <li key={step}><CircleCheck size={18} aria-hidden="true" /> <span>{step}</span></li>)}
              </ol>
            )}
          </section>
        ))}

        <section className={styles.section} aria-labelledby="faq-title">
          <h2 id="faq-title">Частые вопросы</h2>
          <div className={styles.faq}>
            {landing.faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.bottom}>
          <div>
            <h2>Готовы пополнить?</h2>
            <p>Пароль от Roblox не нужен. Поддержка — живой человек в Telegram.</p>
          </div>
          <Link href={landing.cta.href} className={styles.cta}>{landing.cta.label} <ArrowRight size={18} /></Link>
        </section>

        <nav className={styles.more} aria-label="Ещё по теме">
          <h2>Ещё по теме</h2>
          <ul>{others.map((item) => <li key={item.slug}><Link href={`/${item.slug}`}>{item.h1}</Link></li>)}</ul>
        </nav>
      </article>
      <Footer />
    </main>
  );
}
