export default function StatCard({ title, value, sub, accent = false }: {
  title: string; value: string | number; sub?: string; accent?: boolean;
}) {
  return (
    <div style={{
      background: "#2c2c2e", borderRadius: 12, padding: "14px 16px",
      border: accent ? "1px solid #bf5af240" : "1px solid transparent",
    }}>
      <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? "#bf5af2" : "#fff" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
