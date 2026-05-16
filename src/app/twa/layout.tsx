// Telegram SDK loaded globally via root layout (beforeInteractive).
export default function TwaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#1c1c1e", minHeight: "100dvh" }}>
      {children}
    </div>
  );
}
