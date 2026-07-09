import { ImageResponse } from "next/og";

// Auto-served at /opengraph-image for link previews (og:image + twitter:image).
// Same runtime/font approach as apple-icon.tsx — only built-in divs and system
// fonts, no external assets, so it renders on the self-hosted (non-Vercel) deploy.
export const runtime = "edge";
export const alt = "Roblox Bank — купить Robux за рубли";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: "#080c18",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "0 90px",
          fontFamily: "Arial Black, Arial, sans-serif",
        }}
      >
        {/* top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 8,
            background: "#00b06f",
          }}
        />

        {/* coin + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 40 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              background: "#9A6F00",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: "50%",
                background: "#F0B429",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ color: "#0D0D1A", fontSize: 56, fontWeight: 900, lineHeight: 1 }}>R</span>
            </div>
          </div>
          <span
            style={{
              color: "#00b06f",
              fontSize: 30,
              fontWeight: 900,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Roblox Bank
          </span>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: "#ffffff", fontSize: 88, fontWeight: 900, lineHeight: 1.02, letterSpacing: -2 }}>
            Купить Robux
          </span>
          <span style={{ color: "#F0B429", fontSize: 88, fontWeight: 900, lineHeight: 1.02, letterSpacing: -2 }}>
            за рубли
          </span>
        </div>

        {/* subline */}
        <span style={{ color: "#8a93a6", fontSize: 30, fontWeight: 700, marginTop: 34 }}>
          Актуальный курс · доставка через геймпасс без пароля
        </span>
      </div>
    ),
    { ...size }
  );
}
