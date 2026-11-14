"use client";

export default function TwaError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100dvh", background: "#1c1c1e", color: "#ff453a", padding: 24, fontFamily: "monospace",
    }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontWeight: 600, marginBottom: 8, color: "#fff" }}>Ошибка загрузки</div>
      <div style={{ fontSize: 12, color: "#ff9f0a", wordBreak: "break-all", maxWidth: "90vw", textAlign: "center" }}>
        {error.message}
      </div>
      <div style={{ fontSize: 10, color: "#636366", marginTop: 8, wordBreak: "break-all", maxWidth: "90vw", textAlign: "center" }}>
        {error.stack?.split("\n").slice(0, 3).join(" | ")}
      </div>
      <button
        onClick={reset}
        style={{
          marginTop: 20, padding: "10px 24px", borderRadius: 12, border: "none",
          background: "#0a84ff", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
        }}
      >
        Попробовать снова
      </button>
    </div>
  );
}
