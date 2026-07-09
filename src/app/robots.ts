import type { MetadataRoute } from "next";

// Served at /robots.txt. Keep app/admin/private surfaces out of the index;
// allow the public storefront + legal docs.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        "/twa",
        "/dashboard",
        "/checkout",
        "/payment",
        "/login",
        "/register",
      ],
    },
    sitemap: "https://robloxbank.ru/sitemap.xml",
    host: "https://robloxbank.ru",
  };
}
