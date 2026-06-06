export default function TwaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#1c1c1e", minHeight: "100dvh" }}>
      <script dangerouslySetInnerHTML={{ __html: `try{window.Telegram&&window.Telegram.WebApp&&(window.Telegram.WebApp.ready(),window.Telegram.WebApp.expand())}catch(e){}` }} />
      {children}
    </div>
  );
}
