import { Metadata } from "next";
import WBInstructionV2 from "../WBInstructionV2";

// Permanent direct preview of the WB instruction — no gate, no intro, no bot,
// no DB code, no session restore. Renders WBInstructionV2 straight from the
// server so the owner can always open the instruction in a browser.
//   https://www.robloxbank.ru/guide/preview            (номинал 1000 по умолчанию)
//   https://www.robloxbank.ru/guide/preview?nom=500    (любой номинал)
export const metadata: Metadata = {
  title: "Инструкция WB — превью | Roblox Bank",
  description: "Постоянное превью WB-инструкции для проверок.",
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ nom?: string }>;
}

export default async function WBPreviewPage({ searchParams }: Props) {
  const { nom } = await searchParams;
  const parsed = nom ? parseInt(nom, 10) : NaN;
  const denomination = Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;

  return <WBInstructionV2 denomination={denomination} code="" />;
}
