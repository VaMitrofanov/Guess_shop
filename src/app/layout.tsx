import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/session-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Roblox Bank — купить Robux за рубли",
  description: "Быстрая и безопасная покупка Robux за рубли. Лучший курс, мгновенная доставка через геймпасс.",
  keywords: ["купить робуксы", "robux за рубли", "roblox bank", "робуксы дешево"],
  openGraph: {
    title: "Roblox Bank — купить Robux за рубли",
    description: "Быстрая покупка Robux. Лучший курс на рынке.",
    url: "https://robloxbank.ru",
    siteName: "Roblox Bank",
    locale: "ru_RU",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
