import { Metadata } from "next";
import GuideClient from "./GuideClient";

export const metadata: Metadata = {
  title: "Инструкция по созданию геймпасса | Roblox Bank",
  description:
    "Пошаговая инструкция по созданию геймпасса в Roblox для получения Robux",
};

interface GuidPageProps {
  searchParams: Promise<{ source?: string; skip?: string }>;
}

export default async function GuidePage({ searchParams }: GuidPageProps) {
  const { source, skip } = await searchParams;
  const isWB = source === "wb";
  // skip=1 is set by the TG/VK bot after code activation — bypass gate, show guide directly
  const skipGate = isWB && !!skip;

  return (
    <>
      {/* Visible in "View Source" — confirms this response came from RobloxBank-Guide container */}
      <span
        id="__svc"
        data-served-by="RobloxBank-Guide"
        style={{ display: "none" }}
        aria-hidden="true"
      />
      <GuideClient isWB={isWB} skipGate={skipGate} />
    </>
  );
}
