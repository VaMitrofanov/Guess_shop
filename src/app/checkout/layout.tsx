import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Оформление заказа — RobloxBank",
  description: "Выбор геймпасса, проверка цены и подтверждение заказа RobloxBank.",
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
