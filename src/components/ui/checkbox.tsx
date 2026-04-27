"use client";

/**
 * Minimal accessible Checkbox.
 *
 * Why custom and not @radix-ui/react-checkbox: the project doesn't ship
 * shadcn/ui — adding a Radix Checkbox would pull two new runtime deps
 * (@radix-ui/react-checkbox + class-variance-authority) just for one input.
 * A native `<input type="checkbox">` driven by Tailwind hits 100% a11y
 * (built-in keyboard, focus, ARIA) at zero dep cost and matches the
 * hand-rolled pixel aesthetic used elsewhere.
 *
 * Pattern: invisible native input + decorative box rendered via sibling
 * selectors. The native input stays focusable so `Tab` and Space work.
 */

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Visible square size in px. Default 20. */
  boxSize?: number;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, boxSize = 20, disabled, ...props }, ref) {
    return (
      <span
        className={cn(
          "relative inline-flex items-center justify-center flex-shrink-0",
          disabled && "opacity-40 cursor-not-allowed",
          className,
        )}
        style={{ width: boxSize, height: boxSize }}
      >
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          {...props}
        />
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 border-2 border-[#1e2a45] bg-[#080c18] transition-colors",
            "peer-hover:border-[#00b06f]/40",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-[#00b06f]/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#06080f]",
            "peer-checked:bg-[#00b06f] peer-checked:border-[#00b06f]",
          )}
        />
        <Check
          aria-hidden
          className="relative w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
          strokeWidth={3}
        />
      </span>
    );
  },
);
