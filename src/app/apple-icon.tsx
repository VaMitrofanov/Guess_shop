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
          background: "#251B3F",
          borderRadius: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* RobloxBank vault door */}
        <div
          style={{
            width: 148,
            height: 148,
            borderRadius: 38,
            background: "#7556E8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 112,
              height: 112,
              borderRadius: "50%",
              background: "#FBFAFF",
              border: "10px solid #45D6AA",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                color: "#251B3F",
                fontSize: 48,
                fontWeight: 900,
                fontFamily: "Arial Black, Arial, sans-serif",
                lineHeight: 1,
                marginTop: 4,
              }}
            >
              R$
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 180, height: 180 }
  );
}
