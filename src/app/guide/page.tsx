import { Metadata } from "next";
import GuideClient from "./GuideClient";

export const metadata: Metadata = {
  title: "Инструкция по созданию геймпасса | Roblox Bank",
  description:
    "Пошаговая инструкция по созданию геймпасса в Roblox для получения Robux",
};

interface GuidPageProps {
  searchParams: Promise<{ source?: string }>;
}

export default async function GuidePage({ searchParams }: GuidPageProps) {
  const { source } = await searchParams;
  const isWB = source === "wb";

  return <GuideClient isWB={isWB} />;
}
