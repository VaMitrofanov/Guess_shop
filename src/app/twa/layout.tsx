export default function TwaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src="https://telegram.org/js/telegram-web-app.js" />
      <div style={{ background: "#1c1c1e", minHeight: "100dvh" }}>
        {children}
      </div>
    </>
  );
}
