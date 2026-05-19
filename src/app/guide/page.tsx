import { Metadata } from "next";
import GuideClient from "./GuideClient";

export const metadata: Metadata = {
  title: "Инструкция по созданию геймпасса | Roblox Bank",
  description:
    "Пошаговая инструкция по созданию геймпасса в Roblox для получения Robux",
};

interface GuidPageProps {
  searchParams: Promise<{ source?: string; skip?: string; code?: string }>;
}

export default async function GuidePage({ searchParams }: GuidPageProps) {
  const { source, skip, code } = await searchParams;
  const isWB = source === "wb";
  const skipGate = isWB && !!skip;
  // code passed by TG/VK bot so the instruction page opens even in Telegram's WebView
  // (which has a separate localStorage from the regular browser)
  const wbCodeFromUrl = skipGate && code ? code.trim().toUpperCase() : undefined;

  return (
    <>
      {/* Visible in "View Source" — confirms this response came from RobloxBank-Guide container */}
      <span
        id="__svc"
        data-served-by="RobloxBank-Guide"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <GuideClient isWB={isWB} skipGate={skipGate} wbCodeFromUrl={wbCodeFromUrl} />
    </>
  );
}
