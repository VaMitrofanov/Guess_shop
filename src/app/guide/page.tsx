import { Metadata } from "next";
import GuideClient from "./GuideClient";

export const metadata: Metadata = {
  title: "Инструкция по созданию геймпасса | Roblox Bank",
  description:
    "Пошаговая инструкция по созданию геймпасса в Roblox для получения Robux",
};

interface GuidPageProps {
  searchParams: Promise<{ source?: string; skip?: string; code?: string; test?: string; nom?: string }>;
}

export default async function GuidePage({ searchParams }: GuidPageProps) {
  const { source, skip, code, test, nom } = await searchParams;
  const isWB = source === "wb";
  const skipGate = isWB && !!skip;
  // code passed by TG/VK bot so the instruction page opens even in Telegram's WebView
  // (which has a separate localStorage from the regular browser)
  const wbCodeFromUrl = skipGate && code ? code.trim().toUpperCase() : undefined;
  // Silent QA preview of the instruction (no reservation, no bot, no admin alert):
  //   /guide?source=wb&test=1[&nom=1000]   or   /guide?source=wb&code=TESTDEV
  const codeUp = code?.trim().toUpperCase();
  const testMode = isWB && (test === "1" || codeUp === "TESTDEV");
  const testNom = nom ? Math.max(0, parseInt(nom, 10) || 0) : undefined;

  return (
    <>
      {/* Visible in "View Source" — confirms this response came from RobloxBank-Guide container */}
      <span
        id="__svc"
        data-served-by="RobloxBank-Guide-v2"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <GuideClient isWB={isWB} skipGate={skipGate} wbCodeFromUrl={wbCodeFromUrl} testMode={testMode} testNom={testNom} />
    </>
  );
}
