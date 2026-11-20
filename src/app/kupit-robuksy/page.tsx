import LandingPage, { landingMetadata } from "@/components/seo/landing-page";

export const metadata = landingMetadata("kupit-robuksy");
// Цены кодов идут за курсом доллара (20.11.2026) — страница рендерится на запрос.
export const dynamic = "force-dynamic";

export default function Page() {
  return <LandingPage slug="kupit-robuksy" />;
}
