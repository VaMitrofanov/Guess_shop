"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import css from "./scratch-reveal.module.css";

/**
 * 🎨 З5 (18.11.2026): код открывается, как настоящая скретч-карта — серебристый
 * слой стирается пальцем/мышью. Код запрашивается при ПЕРВОМ касании
 * (`fetchCode`), а когда стёрто ~40 % — слой тает, короткое конфетти, и
 * родитель показывает обычный блок «Скопировать / Активировать» (`onRevealed`).
 * «Открыть сразу» — для клавиатуры, скринридеров и тех, кому некогда.
 */
export default function ScratchReveal({ fetchCode, onRevealed }: { fetchCode: () => Promise<string | null>; onRevealed: (code: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const codeRef = useRef<string | null>(null);
  const loading = useRef(false);
  const drawing = useRef(false);
  const moves = useRef(0);
  const [code, setCode] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  // Серебристый слой с «блеском».
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const g = ctx.createLinearGradient(0, 0, rect.width, rect.height);
    g.addColorStop(0, "#cfc6ee"); g.addColorStop(0.45, "#f1edff"); g.addColorStop(0.55, "#ffffff"); g.addColorStop(1, "#bfb4e6");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(117,86,232,.18)";
    for (let x = -rect.height; x < rect.width; x += 10) { ctx.fillRect(x, 0, 3, rect.height); }
  }, []);

  const load = useCallback(async () => {
    if (codeRef.current || loading.current) return codeRef.current;
    loading.current = true;
    const value = await fetchCode().catch(() => null);
    loading.current = false;
    if (value) { codeRef.current = value; setCode(value); } else setFailed(true);
    return value;
  }, [fetchCode]);

  const finish = useCallback(async () => {
    const value = codeRef.current ?? await load();
    if (!value) return;
    setDone(true);
    window.setTimeout(() => onRevealed(value), 900);
  }, [load, onRevealed]);

  const scratchedShare = (canvas: HTMLCanvasElement): number => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return 1;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let clear = 0, total = 0;
    for (let i = 3; i < data.length; i += 4 * 24) { total++; if (data[i] === 0) clear++; }
    return total ? clear / total : 1;
  };

  const erase = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || done) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(event.clientX - rect.left, event.clientY - rect.top, 20, 0, Math.PI * 2);
    ctx.fill();
    if (++moves.current % 8 === 0 && scratchedShare(canvas) > 0.4) void finish();
  };

  return (
    <div>
      <div className={css.wrap}>
        <div className={css.under} aria-live="polite">{code ?? (failed ? "Не открылся — нажмите «Открыть сразу»" : "•••• •••• ••••")}</div>
        <canvas
          ref={canvasRef}
          className={`${css.canvas} ${done ? css.gone : ""}`}
          aria-hidden="true"
          onPointerDown={(e) => { drawing.current = true; setTouched(true); void load(); e.currentTarget.setPointerCapture(e.pointerId); erase(e); }}
          onPointerMove={(e) => { if (drawing.current) erase(e); }}
          onPointerUp={() => { drawing.current = false; }}
          onPointerCancel={() => { drawing.current = false; }}
        />
        <span className={`${css.hint} ${touched || done ? css.hintHidden : ""}`} aria-hidden="true">Сотрите, чтобы открыть код</span>
        {done && (
          <span className={css.burst} aria-hidden="true">
            {["#7556e8", "#45d6aa", "#ffd36b", "#229ED9", "#ff6aa8", "#7556e8", "#45d6aa", "#ffd36b"].map((c, i) => (
              <i key={i} style={{ background: c, ["--x" as string]: `${Math.round(Math.cos(i * 0.8) * 120)}px`, ["--y" as string]: `${Math.round(Math.sin(i * 0.8) * 60 - 30)}px`, ["--r" as string]: `${i * 70}deg` }} />
            ))}
          </span>
        )}
      </div>
      {!done && <button type="button" className={css.skip} onClick={() => void finish()}>Открыть сразу</button>}
    </div>
  );
}
