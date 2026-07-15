import type { Metadata } from "next";
import { LegalDocument, SectionTitle } from "@/components/legal/legal-document";
import { LEGAL_DETAILS } from "@/lib/legal-details";

export const metadata: Metadata = {
  title: "Реквизиты и контакты — Roblox Bank",
  description: "Юридическая информация и контакты исполнителя Roblox Bank.",
  alternates: { canonical: "https://robloxbank.ru/legal/details" },
  robots: { index: false, follow: false },
};

export default function DetailsPage() {
  return (
    <LegalDocument
      badge="Company details"
      title={<>Реквизиты <span className="gold-text">и контакты</span></>}
      subtitle="Юридическая информация исполнителя и адрес для обращений по заказам, возвратам и вопросам обработки персональных данных."
      lastUpdated={LEGAL_DETAILS.lastUpdated}
    >
      <section>
        <SectionTitle number="01">Исполнитель</SectionTitle>
        <ul>
          <li><strong>Наименование:</strong> {LEGAL_DETAILS.entity}</li>
          <li><strong>ИНН:</strong> {LEGAL_DETAILS.inn}</li>
          <li><strong>ОГРНИП:</strong> {LEGAL_DETAILS.ogrn}</li>
          <li><strong>Юридический адрес:</strong> {LEGAL_DETAILS.address}</li>
          <li><strong>Телефон поддержки:</strong> <a href={`tel:${LEGAL_DETAILS.phone.replace(/[^+\d]/g, "")}`}>{LEGAL_DETAILS.phone}</a></li>
          <li><strong>Система налогообложения:</strong> {LEGAL_DETAILS.taxSystem}</li>
        </ul>
      </section>
      <section>
        <SectionTitle number="02">Контакты</SectionTitle>
        <p>По вопросам заказов, возвратов и обработки персональных данных: <a href={`tel:${LEGAL_DETAILS.phone.replace(/[^+\d]/g, "")}`}>{LEGAL_DETAILS.phone}</a> и <a href={`mailto:${LEGAL_DETAILS.email}`}>{LEGAL_DETAILS.email}</a>.</p>
        <p><strong>Часы поддержки:</strong> {LEGAL_DETAILS.supportHours}. {LEGAL_DETAILS.supportSla}.</p>
        <p>Условия оказания услуг и возврата опубликованы в <a href="/legal/offer">публичной оферте</a>.</p>
      </section>
    </LegalDocument>
  );
}
