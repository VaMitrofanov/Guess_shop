import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// Превью ссылки (og:image + twitter:image), 15.11.2026 — в языке витрины 2.0:
// фиолетовый, чернила, мята, жёлтый «ХИТ». Только flex-разметка и встроенный
// шрифт: картинка строится при сборке на своём сервере, без сети и Edge.
export const alt = "RobloxBank — Robux кодом, сразу на баланс";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PACKS: { amount: string; price: string; hit?: boolean; dark?: boolean; rotate: number; top: number; left: number }[] = [
  { amount: "100", price: "239 ₽", rotate: -8, top: 40, left: 800 },
  { amount: "10 000", price: "10 529 ₽", rotate: 5, top: 425, left: 870 },
  { amount: "800", price: "999 ₽", hit: true, dark: true, rotate: -3, top: 238, left: 830 },
];

/** Unbounded (OFL) — шрифт заголовков витрины; встроенный в next/og не умеет жирный и кириллицу красиво. */
async function font(weight: 600 | 800) {
  return readFile(path.join(process.cwd(), "src/assets/og-fonts", `Unbounded-${weight}.ttf`));
}

export default async function OpengraphImage() {
  const [semi, heavy] = await Promise.all([font(600), font(800)]);
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          position: "relative",
          background: "linear-gradient(150deg, #2e2052 0%, #7556e8 62%, #5b82ed 100%)",
          fontFamily: "Unbounded",
          color: "#ffffff",
          overflow: "hidden",
        }}
      >
        {/* мягкие круги фона */}
        <div style={{ position: "absolute", right: -160, top: -160, width: 560, height: 560, borderRadius: 999, border: "70px solid rgba(255,255,255,0.08)", display: "flex" }} />
        <div style={{ position: "absolute", left: -120, bottom: -200, width: 420, height: 420, borderRadius: 999, background: "rgba(69,214,170,0.18)", display: "flex" }} />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 0 0 80px", width: 760, gap: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 70, height: 70, borderRadius: 20, background: "#ffffff", color: "#7556e8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, boxShadow: "6px 6px 0 #45d6aa" }}>R$</div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 3 }}>ROBLOXBANK</div>
          </div>
          <div style={{ display: "flex", alignSelf: "flex-start", padding: "10px 22px", borderRadius: 999, background: "#45d6aa", color: "#14473a", fontSize: 24, fontWeight: 800, letterSpacing: 2 }}>КОДЫ ROBLOX</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 62, fontWeight: 800, lineHeight: 1.08, letterSpacing: -3 }}>
            <span>Robux кодом</span>
            <span style={{ color: "#ffd36b" }}>сразу на баланс</span>
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: "#e6deff" }}>Без пароля · картой или СБП · в подарок</div>
        </div>

        {PACKS.map((pack) => (
          <div
            key={pack.amount}
            style={{
              position: "absolute",
              top: pack.top,
              left: pack.left,
              width: 270,
              height: 165,
              borderRadius: 26,
              background: pack.dark ? "#251b3f" : "#ffffff",
              color: pack.dark ? "#ffffff" : "#251b3f",
              boxShadow: pack.dark ? "10px 10px 0 #45d6aa" : "10px 10px 0 #251b3f",
              transform: `rotate(${pack.rotate}deg)`,
              padding: "24px 26px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {pack.hit && (
              <div style={{ position: "absolute", top: -18, left: 18, padding: "6px 16px", borderRadius: 999, background: "#ff8a3d", color: "#3d1a02", fontSize: 20, fontWeight: 800, display: "flex" }}>ХИТ</div>
            )}
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800, letterSpacing: -2, whiteSpace: "nowrap" }}>{pack.amount}</div>
            <div style={{ display: "flex", fontSize: 18, fontWeight: 800, letterSpacing: 3, color: pack.dark ? "#8cf0d0" : "#7556e8" }}>ROBUX</div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 600, marginTop: 8, color: pack.dark ? "#ddd6f3" : "#5f566f" }}>{pack.price}</div>
          </div>
        ))}
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Unbounded", data: semi, weight: 600, style: "normal" },
        { name: "Unbounded", data: heavy, weight: 800, style: "normal" },
      ],
    },
  );
}
