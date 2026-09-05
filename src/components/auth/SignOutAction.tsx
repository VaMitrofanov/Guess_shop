"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

export default function SignOutAction({ className, children }: { className?: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut({ callbackUrl: "/" });
      }}
    >
      {children}
    </button>
  );
}
