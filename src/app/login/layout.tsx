import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Вход в личный кабинет — RobloxBank",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
