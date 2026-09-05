import type { MetadataRoute } from "next";

// Served at /sitemap.xml. Public, indexable pages only — no app/admin routes.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://robloxbank.ru";
  const pages: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/",               priority: 1.0, changeFrequency: "weekly"  },
    { path: "/guide",          priority: 0.9, changeFrequency: "monthly" },
    { path: "/faq",            priority: 0.7, changeFrequency: "monthly" },
    { path: "/guarantees",     priority: 0.6, changeFrequency: "monthly" },
    { path: "/reviews",        priority: 0.6, changeFrequency: "weekly"  },
    // Legal pages intentionally stay out until owner requisites replace every
    // placeholder and the texts pass legal acceptance.
  ];

  return pages.map(({ path, priority, changeFrequency }) => ({
    url: `${base}${path}`,
    changeFrequency,
    priority,
  }));
}
