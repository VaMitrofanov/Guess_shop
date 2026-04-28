import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#0D0D1A",
          borderRadius: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Coin outer ring */}
        <div
          style={{
            width: 148,
            height: 148,
            borderRadius: "50%",
            background: "#9A6F00",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Coin face */}
          <div
            style={{
              width: 132,
              height: 132,
              borderRadius: "50%",
              background: "#F0B429",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                color: "#0D0D1A",
                fontSize: 84,
                fontWeight: 900,
                fontFamily: "Arial Black, Arial, sans-serif",
                lineHeight: 1,
                marginTop: 4,
              }}
            >
              R
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 180, height: 180 }
  );
}
