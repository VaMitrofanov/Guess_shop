import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Статус оплаты — RobloxBank",
  robots: { index: false, follow: false },
};

export default function PaymentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
