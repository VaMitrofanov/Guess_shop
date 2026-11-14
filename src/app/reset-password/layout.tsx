import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Новый пароль — RobloxBank",
  robots: { index: false, follow: false },
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) { return children; }
