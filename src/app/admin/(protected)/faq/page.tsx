import { prisma } from "@/lib/prisma";
import FAQList from "@/components/admin/faq-list";
import AddFAQModal from "@/components/admin/add-faq-modal";

export const dynamic = "force-dynamic";

export default async function AdminFAQPage() {
  const faqs = await prisma.fAQ.findMany({ orderBy: { order: "asc" } });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">CONTENT MANAGEMENT</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">FAQ</h1>
          <p className="text-zinc-500 text-sm font-medium mt-1">{faqs.length} вопросов</p>
        </div>
        <AddFAQModal />
      </div>
      <FAQList initialFaqs={JSON.parse(JSON.stringify(faqs))} />
    </div>
  );
}
