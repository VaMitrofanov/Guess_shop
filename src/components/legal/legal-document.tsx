import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import AnoAI from "@/components/ui/animated-shader-background";

/**
 * Shared frame for legal pages (policy, offer, future docs).
 *
 * Why one component: all legal docs share the same header band, accent
 * line, last-updated timestamp, and reading-friendly typography. Putting
 * the chrome in one place means we tweak the visual once when legal
 * counsel asks for changes — not per-document.
 *
 * Children should be plain semantic markup (<section>, <h2>, <p>, <ol>).
 * Spacing/typography is handled by the inner `.prose-legal` selectors
 * defined in this file's className tree below — kept inline rather than
 * in globals.css so the styling is co-located with the layout.
 */
export function LegalDocument({
  badge = "Legal Document",
  title,
  subtitle,
  lastUpdated,
  children,
}: {
  badge?: string;
  title: React.ReactNode;
  subtitle?: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen relative bg-[#080c18]">
      {/* Background shader — same as /privacy for visual consistency */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-30">
        <AnoAI />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />

        <article className="flex-grow container mx-auto px-4 py-20 max-w-4xl">
          <header className="fade-up mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 border border-[#00b06f]/20 bg-[#00b06f]/5 text-[#00b06f] text-[10px] font-black uppercase tracking-widest mb-6">
              <span className="w-1.5 h-1.5 bg-[#00b06f] rounded-none" />
              {badge}
            </div>
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight mb-3">
              {title}
            </h1>
            {subtitle && (
              <p className="text-zinc-400 text-base font-medium leading-relaxed max-w-2xl mb-4">
                {subtitle}
              </p>
            )}
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">
              Последнее обновление: {lastUpdated}
            </p>
          </header>

          <div className="accent-line mb-12" />

          {/*
            Typography rules for legal copy:
              • body text: zinc-300, relaxed leading, comfortable line length
              • numbered sections (h2): white, uppercase, 01 / 02 prefixes
              • subsections (h3): zinc-100, normal-case, smaller
              • paragraphs: 1rem (text-base) for readability
              • lists: indented with disc markers, 0.75rem gap
            All of it expressed via Tailwind utilities below — no globals.css
            churn needed.
          */}
          <div
            className={[
              "space-y-12 text-zinc-300 text-[15px] leading-relaxed",
              "[&_h2]:text-xl [&_h2]:font-black [&_h2]:uppercase [&_h2]:tracking-tight [&_h2]:text-white",
              "[&_h2]:flex [&_h2]:items-center [&_h2]:gap-3 [&_h2]:mb-4",
              "[&_h3]:text-base [&_h3]:font-black [&_h3]:tracking-tight [&_h3]:text-zinc-100 [&_h3]:mt-6 [&_h3]:mb-2",
              "[&_p]:leading-relaxed [&_p]:mb-3",
              "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:my-3",
              "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:my-3",
              "[&_li]:leading-relaxed",
              "[&_a]:text-[#00b06f] [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:opacity-80",
              "[&_strong]:text-white [&_strong]:font-black",
            ].join(" ")}
          >
            {children}
          </div>

          <div className="mt-16 pt-8 border-t border-[#1e2a45] text-center">
            <p className="text-zinc-600 text-xs uppercase tracking-widest">
              Используя сервис Roblox Bank, вы подтверждаете согласие с настоящим документом.
            </p>
          </div>
        </article>

        <Footer />
      </div>
    </main>
  );
}

/** Pixel-style numbered section heading: "01 Общие положения" */
export function SectionTitle({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <h2>
      <span className="text-[#00b06f]">{number}</span> {children}
    </h2>
  );
}
