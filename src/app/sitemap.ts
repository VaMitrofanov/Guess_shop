import type { MetadataRoute } from "next";
import { LANDINGS } from "@/lib/seo/landings";

// Served at /sitemap.xml. Public, indexable pages only — no app/admin routes.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://robloxbank.ru";
  const pages: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/",               priority: 1.0, changeFrequency: "weekly"  },
    { path: "/guide",          priority: 0.9, changeFrequency: "monthly" },
    { path: "/faq",            priority: 0.7, changeFrequency: "monthly" },
    { path: "/guarantees",     priority: 0.6, changeFrequency: "monthly" },
    { path: "/pending",        priority: 0.6, changeFrequency: "monthly" },
    { path: "/reviews",        priority: 0.6, changeFrequency: "weekly"  },
    // 🔎 Посадочные под поиск (15.11.2026).
    ...LANDINGS.map((landing) => ({ path: `/${landing.slug}`, priority: 0.8, changeFrequency: "monthly" as const })),
    // Legal pages intentionally stay out until owner requisites replace every
    // placeholder and the texts pass legal acceptance.
  ];

  return pages.map(({ path, priority, changeFrequency }) => ({
    url: `${base}${path}`,
    changeFrequency,
    priority,
  }));
}
