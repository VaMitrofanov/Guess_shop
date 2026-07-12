import Script from "next/script";

export default function TwaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#1c1c1e", minHeight: "100dvh" }}>
      <Script src="/vendor/telegram-web-app.js" strategy="afterInteractive" />
      {children}
    </div>
  );
}
