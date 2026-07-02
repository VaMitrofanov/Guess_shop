import { C, RADIUS } from "./theme";

/* Canonical metric card for the whole TWA. `accent` paints a left bar + tints
   the value; `subColor` lets callers color the sub line (e.g. ↑/↓ deltas). */
export default function StatCard({ title, value, sub, subColor, accent = false }: {
  title: string; value: string | number; sub?: string; subColor?: string; accent?: boolean;
}) {
  return (
    <div style={{
      background: C.card, borderRadius: RADIUS.md, padding: "14px 16px",
      borderLeft: accent ? `3px solid ${C.accent}` : "1px solid transparent",
    }}>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? C.accent : C.textPrimary }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: subColor ?? C.textSecondary, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
