"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Shows a 2px green top-loading bar on every page navigation.
 * Also applies a fade-in animation to the main content via CSS class.
 */
export function PageLoader() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const [key, setKey] = useState(0);

  useEffect(() => {
    // Re-trigger animation on every route change
    setKey(k => k + 1);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!visible) return null;

  return <div key={key} className="page-loader" aria-hidden="true" />;
}

/**
 * Wraps page content with a fade-in animation on mount / route change.
 */
export function PageContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <main key={pathname} className="page-enter flex-1 flex flex-col">
      {children}
    </main>
  );
}
