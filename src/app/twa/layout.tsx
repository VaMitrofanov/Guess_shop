import Script from "next/script";

export default function TwaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="lazyOnload" />
      <div style={{ background: "#1c1c1e", minHeight: "100dvh" }}>
        {children}
      </div>
    </>
  );
}
