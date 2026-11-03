import Script from "next/script";
import TwaViewportGuard from "./_components/TwaViewportGuard";

export default function TwaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="twa-route-host">
      <TwaViewportGuard />
      <Script src="/vendor/telegram-web-app.js" strategy="afterInteractive" />
      {children}
    </div>
  );
}
