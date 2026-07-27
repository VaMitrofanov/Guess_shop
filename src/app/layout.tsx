import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Press_Start_2P, Unbounded } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/session-provider";
import { PageLoader } from "@/components/page-loader";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteObservability } from "@/components/site-observability";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

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

const unbounded = Unbounded({
  variable: "--font-display",
  weight: ["600", "700"],
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  // Absolute base for OG/canonical URLs and the auto-generated opengraph-image.
  // Without it, relative asset URLs (og:image) don't resolve and link previews
  // come up blank.
  metadataBase: new URL("https://robloxbank.ru"),
  title: "Roblox Bank — купить Robux за рубли",
  description: "Быстрая и безопасная покупка Robux за рубли. Актуальный курс, доставка через геймпасс без ввода пароля.",
  keywords: ["купить робуксы", "robux за рубли", "roblox bank", "робуксы дешево"],
  openGraph: {
    title: "Roblox Bank — купить Robux за рубли",
    description: "Покупка Robux за рубли. Актуальный курс, доставка через геймпасс.",
    url: "https://robloxbank.ru",
    siteName: "Roblox Bank",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Roblox Bank — купить Robux за рубли",
    description: "Покупка Robux за рубли. Актуальный курс, доставка через геймпасс.",
  },
};

// Keep form actions visible when iOS/Android or an embedded TG/VK browser
// opens the software keyboard. `viewportFit: cover` also makes the safe-area
// env variables available to the route CSS on notched devices.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0912" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} ${pressStart.variable} ${unbounded.variable} h-full antialiased`}
    >
      <head>
        {/* D3: ставит data-theme до первой отрисовки, иначе на тёмном телефоне
            первый кадр приходит в светлой теме и потом скачком перекрашивается.
            Разрешён в CSP по sha256-хешу (next-security.ts), не unsafe-inline. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <SessionProvider>
            <PageLoader />
            <SiteObservability />
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
