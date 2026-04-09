"use client";
import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * NavbarLampGlow — compact lamp effect for the sticky navbar.
 * Renders absolutely-positioned decorative beams behind navbar content.
 * Color: #00b06f (project green) instead of original cyan.
 */
export const NavbarLampGlow = ({ className }: { className?: string }) => {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden z-0",
        className
      )}
      aria-hidden="true"
    >
      {/* Left beam — conic gradient from top-center going left */}
      <motion.div
        initial={{ opacity: 0, width: "8rem" }}
        animate={{ opacity: 1, width: "18rem" }}
        transition={{ delay: 0.2, duration: 1, ease: "easeInOut" }}
        style={{
          backgroundImage: `conic-gradient(from 70deg at center top, var(--tw-gradient-stops))`,
        }}
        className="absolute inset-auto right-1/2 top-0 h-28 bg-gradient-conic from-[#00b06f] via-transparent to-transparent [--tw-gradient-stops:theme(colors.transparent),theme(colors.transparent),#00b06f]"
      >
        {/* fade edges */}
        <div className="absolute bottom-0 left-0 h-full w-12 bg-[#0a0e1a] [mask-image:linear-gradient(to_right,white,transparent)]" />
        <div className="absolute bottom-0 left-0 h-8 w-full bg-[#0a0e1a] [mask-image:linear-gradient(to_top,white,transparent)]" />
      </motion.div>

      {/* Right beam */}
      <motion.div
        initial={{ opacity: 0, width: "8rem" }}
        animate={{ opacity: 1, width: "18rem" }}
        transition={{ delay: 0.2, duration: 1, ease: "easeInOut" }}
        style={{
          backgroundImage: `conic-gradient(from 290deg at center top, var(--tw-gradient-stops))`,
        }}
        className="absolute inset-auto left-1/2 top-0 h-28 bg-gradient-conic from-transparent via-transparent to-[#00b06f] [--tw-gradient-stops:theme(colors.transparent),theme(colors.transparent),#00b06f]"
      >
        <div className="absolute bottom-0 right-0 h-full w-12 bg-[#0a0e1a] [mask-image:linear-gradient(to_left,white,transparent)]" />
        <div className="absolute bottom-0 right-0 h-8 w-full bg-[#0a0e1a] [mask-image:linear-gradient(to_top,white,transparent)]" />
      </motion.div>

      {/* Central ambient glow blob */}
      <motion.div
        initial={{ opacity: 0, width: "4rem" }}
        animate={{ opacity: 0.35, width: "14rem" }}
        transition={{ delay: 0.25, duration: 1, ease: "easeInOut" }}
        className="absolute top-0 left-1/2 -translate-x-1/2 h-16 rounded-full bg-[#00b06f] blur-2xl"
      />

      {/* Horizontal lamp wire line */}
      <motion.div
        initial={{ width: "6rem", opacity: 0 }}
        animate={{ width: "22rem", opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.9, ease: "easeInOut" }}
        className="absolute top-[3.5rem] left-1/2 -translate-x-1/2 h-px bg-[#00b06f]/60"
      />

      {/* Small bright center dot on the wire */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7, duration: 0.4, ease: "easeOut" }}
        className="absolute top-[3.5rem] left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[#00d084] shadow-[0_0_6px_2px_#00b06f]"
      />
    </div>
  );
};

/**
 * Full-page LampContainer — kept for standalone page usage.
 */
export const LampContainer = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 w-full rounded-md z-0",
        className
      )}
    >
      <div className="relative flex w-full flex-1 scale-y-125 items-center justify-center isolate z-0">
        <motion.div
          initial={{ opacity: 0.5, width: "15rem" }}
          whileInView={{ opacity: 1, width: "30rem" }}
          transition={{ delay: 0.3, duration: 0.8, ease: "easeInOut" }}
          style={{
            backgroundImage: `conic-gradient(var(--conic-position), var(--tw-gradient-stops))`,
          }}
          className="absolute inset-auto right-1/2 h-56 overflow-visible w-[30rem] bg-gradient-conic from-[#00b06f] via-transparent to-transparent text-white [--conic-position:from_70deg_at_center_top]"
        >
          <div className="absolute w-[100%] left-0 bg-slate-950 h-40 bottom-0 z-20 [mask-image:linear-gradient(to_top,white,transparent)]" />
          <div className="absolute w-40 h-[100%] left-0 bg-slate-950 bottom-0 z-20 [mask-image:linear-gradient(to_right,white,transparent)]" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0.5, width: "15rem" }}
          whileInView={{ opacity: 1, width: "30rem" }}
          transition={{ delay: 0.3, duration: 0.8, ease: "easeInOut" }}
          style={{
            backgroundImage: `conic-gradient(var(--conic-position), var(--tw-gradient-stops))`,
          }}
          className="absolute inset-auto left-1/2 h-56 w-[30rem] bg-gradient-conic from-transparent via-transparent to-[#00b06f] text-white [--conic-position:from_290deg_at_center_top]"
        >
          <div className="absolute w-40 h-[100%] right-0 bg-slate-950 bottom-0 z-20 [mask-image:linear-gradient(to_left,white,transparent)]" />
          <div className="absolute w-[100%] right-0 bg-slate-950 h-40 bottom-0 z-20 [mask-image:linear-gradient(to_top,white,transparent)]" />
        </motion.div>

        <div className="absolute top-1/2 h-48 w-full translate-y-12 scale-x-150 bg-slate-950 blur-2xl" />
        <div className="absolute top-1/2 z-50 h-48 w-full bg-transparent opacity-10 backdrop-blur-md" />
        <div className="absolute inset-auto z-50 h-36 w-[28rem] -translate-y-1/2 rounded-full bg-[#00b06f] opacity-50 blur-3xl" />
        <motion.div
          initial={{ width: "8rem" }}
          whileInView={{ width: "16rem" }}
          transition={{ delay: 0.3, duration: 0.8, ease: "easeInOut" }}
          className="absolute inset-auto z-30 h-36 w-64 -translate-y-[6rem] rounded-full bg-[#00d084] blur-2xl"
        />
        <motion.div
          initial={{ width: "15rem" }}
          whileInView={{ width: "30rem" }}
          transition={{ delay: 0.3, duration: 0.8, ease: "easeInOut" }}
          className="absolute inset-auto z-50 h-0.5 w-[30rem] -translate-y-[7rem] bg-[#00b06f]"
        />
        <div className="absolute inset-auto z-40 h-44 w-full -translate-y-[12.5rem] bg-slate-950" />
      </div>

      <div className="relative z-50 flex -translate-y-80 flex-col items-center px-5">
        {children}
      </div>
    </div>
  );
};

export function LampDemo() {
  return (
    <LampContainer>
      <motion.h1
        initial={{ opacity: 0.5, y: 100 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.8, ease: "easeInOut" }}
        className="mt-8 bg-gradient-to-br from-slate-300 to-slate-500 py-4 bg-clip-text text-center text-4xl font-medium tracking-tight text-transparent md:text-7xl"
      >
        Roblox Bank
      </motion.h1>
    </LampContainer>
  );
}
