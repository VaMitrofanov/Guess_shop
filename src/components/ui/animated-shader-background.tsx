"use client";

/**
 * Animated GLSL-shader background — adaptive performance profile.
 *
 *   • Full quality on desktop with 24 ray-march iterations and DPR up to 2.
 *   • Lite quality on mobile (≤768px or pointer:coarse): DPR clamped to 1
 *     and iterations reduced to 12, which roughly halves GPU cost.
 *   • Pauses RAF when the canvas leaves the viewport (IntersectionObserver)
 *     or when the document is hidden (visibilitychange) — saves battery
 *     while the user reads the steps below the hero.
 *   • Honours `prefers-reduced-motion`: shader is skipped entirely, an inert
 *     CSS gradient is rendered instead.
 *   • Lazy-loaded by callers via `next/dynamic({ ssr: false })` so three.js
 *     never enters the SSR bundle.
 */

import * as React from "react";
import { useEffect, useRef, useState } from "react";

interface ShaderBackgroundProps {
  className?: string;
}

const FALLBACK_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(80% 60% at 50% 30%, rgba(0,176,111,0.18) 0%, rgba(201,168,76,0.06) 40%, transparent 70%), #060814",
  pointerEvents: "none",
};

function buildFragmentShader(iterations: number): string {
  return `
    precision mediump float;
    uniform float iTime;
    uniform vec2  iResolution;

    #define NUM_OCTAVES 3

    float rand(vec2 n) {
      return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 ip = floor(p);
      vec2 u  = fract(p);
      u = u * u * (3.0 - 2.0 * u);
      float res = mix(
        mix(rand(ip),                  rand(ip + vec2(1.0, 0.0)), u.x),
        mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
        u.y
      );
      return res * res;
    }
    float fbm(vec2 x) {
      float v = 0.0;
      float a = 0.3;
      vec2  shift = vec2(100.0);
      mat2  rot   = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
      for (int i = 0; i < NUM_OCTAVES; ++i) {
        v += a * noise(x);
        x = rot * x * 2.0 + shift;
        a *= 0.4;
      }
      return v;
    }

    void main() {
      vec2 shake = vec2(sin(iTime * 1.2) * 0.005, cos(iTime * 2.1) * 0.005);
      vec2 p = ((gl_FragCoord.xy + shake * iResolution.xy) - iResolution.xy * 0.5)
             / iResolution.y * mat2(6.0, -4.0, 4.0, 6.0);
      vec2 v;
      vec4 o = vec4(0.0);
      float f = 2.0 + fbm(p + vec2(iTime * 5.0, 0.0)) * 0.5;

      // Iteration count is baked in at compile time per quality profile.
      for (int i = 0; i < ${iterations}; i++) {
        float fi = float(i);
        v = p + cos(fi * fi + (iTime + p.x * 0.08) * 0.025 + fi * vec2(13.0, 11.0)) * 3.5
              + vec2(sin(iTime * 3.0 + fi) * 0.003, cos(iTime * 3.5 - fi) * 0.003);
        float tailNoise = fbm(v + vec2(iTime * 0.5, fi)) * 0.3 * (1.0 - (fi / float(${iterations})));

        // Project palette: emerald primary + soft gold accent on a deep navy base.
        vec4 auroraColors = vec4(
          0.05 + 0.25 * sin(fi * 0.2 + iTime * 0.4),
          0.35 + 0.45 * cos(fi * 0.3 + iTime * 0.5),
          0.20 + 0.20 * sin(fi * 0.4 + iTime * 0.3),
          1.0
        );

        vec4 currentContribution = auroraColors
          * exp(sin(fi * fi + iTime * 0.8))
          / length(max(v, vec2(v.x * f * 0.015, v.y * 1.5)));
        float thinnessFactor = smoothstep(0.0, 1.0, fi / float(${iterations})) * 0.6;
        o += currentContribution * (1.0 + tailNoise * 0.8) * thinnessFactor;
      }

      o = tanh(pow(o / 100.0, vec4(1.6)));
      gl_FragColor = vec4(o.rgb * 1.4, 1.0);
    }
  `;
}

const VERTEX_SHADER = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

export default function ShaderBackground({ className }: ShaderBackgroundProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect prefers-reduced-motion synchronously on mount so we can skip
  // touching three.js entirely.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    if (typeof window === "undefined") return;
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    let running = false;
    type Ctx = {
      renderer: import("three").WebGLRenderer;
      scene: import("three").Scene;
      camera: import("three").OrthographicCamera;
      material: import("three").ShaderMaterial;
      geometry: import("three").PlaneGeometry;
      canvas: HTMLCanvasElement;
      io?: IntersectionObserver;
      onResize: () => void;
      onVisibility: () => void;
      lastTime: number;
    } | null;
    let ctx: Ctx = null;

    // Quality profile picked once per mount.
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    const isNarrow = window.innerWidth < 768;
    const lite = isCoarse || isNarrow;
    const dprCap = lite ? 1 : 2;
    // Reduced from 18/35 → 12/24: enough fidelity for the aurora effect,
    // measurably easier on weaker GPUs (especially integrated mobile chips).
    const iterations = lite ? 12 : 24;

    let cancelled = false;

    const start = async () => {
      // Dynamic import so three.js stays out of the initial JS bundle.
      const THREE = await import("three");
      if (cancelled || !containerRef.current) return;

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
      renderer.setSize(container.clientWidth, container.clientHeight, false);

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      const material = new THREE.ShaderMaterial({
        uniforms: {
          iTime: { value: 0 },
          iResolution: {
            value: new THREE.Vector2(container.clientWidth, container.clientHeight),
          },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: buildFragmentShader(iterations),
      });

      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      const canvas = renderer.domElement;
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      container.appendChild(canvas);

      const onResize = () => {
        if (!containerRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        renderer.setSize(w, h, false);
        material.uniforms.iResolution.value.set(w, h);
      };

      const onVisibility = () => {
        if (document.hidden) pause();
        else resume();
      };

      // ResizeObserver tracks container dimensions, not just window —
      // important when shader sits inside a section that may change size.
      const ro = new ResizeObserver(onResize);
      ro.observe(container);

      document.addEventListener("visibilitychange", onVisibility);

      // IntersectionObserver pauses RAF when the hero scrolls off-screen.
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) resume();
            else pause();
          }
        },
        { threshold: 0 }
      );
      io.observe(container);

      ctx = {
        renderer,
        scene,
        camera,
        material,
        geometry,
        canvas,
        io,
        onResize,
        onVisibility,
        lastTime: performance.now(),
      };

      // Make ResizeObserver part of cleanup too via a closure flag.
      (ctx as any).ro = ro;

      const animate = (now: number) => {
        if (disposed || !ctx) return;
        const delta = (now - ctx.lastTime) / 1000;
        ctx.lastTime = now;
        // Cap per-frame delta so a paused tab doesn't make a huge jump.
        ctx.material.uniforms.iTime.value += Math.min(delta, 0.05);
        ctx.renderer.render(ctx.scene, ctx.camera);
        frameId = requestAnimationFrame(animate);
      };

      const resume = () => {
        if (running || disposed || !ctx) return;
        running = true;
        ctx.lastTime = performance.now();
        frameId = requestAnimationFrame(animate);
      };

      const pause = () => {
        if (!running) return;
        running = false;
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
      };

      // Save pause/resume on the closure, not on ctx, so the hooks above can call them.
      (ctx as any).pause = pause;
      (ctx as any).resume = resume;

      resume();
    };

    start().catch((err) => {
      // Swallow the error — we just stay on the CSS fallback.
      console.warn("[shader-bg] init failed, falling back to gradient:", err);
    });

    return () => {
      cancelled = true;
      disposed = true;
      if (frameId) cancelAnimationFrame(frameId);
      if (!ctx) return;
      try {
        document.removeEventListener("visibilitychange", ctx.onVisibility);
        ctx.io?.disconnect();
        (ctx as any).ro?.disconnect?.();
        if (ctx.canvas.parentNode === container) {
          container.removeChild(ctx.canvas);
        }
        ctx.geometry.dispose();
        ctx.material.dispose();
        ctx.renderer.dispose();
      } catch {
        // Ignore — we're tearing down.
      }
      ctx = null;
    };
  }, [reducedMotion]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        // Inert fallback gradient — visible while shader is initialising
        // or permanently if reduced-motion / WebGL is unavailable.
        ...FALLBACK_STYLE,
      }}
    />
  );
}
