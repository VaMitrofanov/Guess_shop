import type { Metadata } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";
import Script from "next/script";
import SessionProvider from "@/components/session-provider";
import { PageLoader } from "@/components/page-loader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pressStart = Press_Start_2P({
  variable: "--font-pixel",
  weight: "400",
  subsets: ["latin", "cyrillic"],
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
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__tgHash=location.hash;window.onerror=function(m,s,l,c,e){var d=document.getElementById('__twa_err');if(d)d.textContent='JS Error: '+m+' at '+s+':'+l;};window.onunhandledrejection=function(e){var d=document.getElementById('__twa_err');if(d)d.textContent='Promise: '+(e.reason||e);};`,
          }}
        />
        <SessionProvider>
          {/* Self-hosted copies (public/vendor/): telegram.org и unpkg.com (за
              Cloudflare) нестабильны у российских провайдеров без VPN, а
              beforeInteractive-скрипт с внешнего домена блокировал парсинг всей
              страницы. Обновлять при апдейтах Bot API / VK ID SDK. */}
          <Script
            src="/vendor/telegram-web-app.js"
            strategy="beforeInteractive"
          />
          <Script
            src="/vendor/vkid-sdk-2.6.5.js"
            strategy="afterInteractive"
          />
          <PageLoader />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
