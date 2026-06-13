import { C, RADIUS, tint } from "./theme";

export default function StatCard({ title, value, sub, accent = false }: {
  title: string; value: string | number; sub?: string; accent?: boolean;
}) {
  return (
    <div style={{
      background: C.card, borderRadius: RADIUS.md, padding: "14px 16px",
      border: accent ? `1px solid ${tint(C.accent, 0.25)}` : "1px solid transparent",
    }}>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? C.accent : C.textPrimary }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
