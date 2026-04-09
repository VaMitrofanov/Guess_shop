"use client"
import { useEffect, useRef, useCallback } from "react"

interface Vector2D {
  x: number
  y: number
}

class Particle {
  pos: Vector2D = { x: 0, y: 0 }
  vel: Vector2D = { x: 0, y: 0 }
  acc: Vector2D = { x: 0, y: 0 }
  target: Vector2D = { x: 0, y: 0 }
  closeEnoughTarget = 100
  maxSpeed = 1.0
  maxForce = 0.1
  particleSize = 10
  isKilled = false
  startColor = { r: 0, g: 0, b: 0 }
  targetColor = { r: 0, g: 0, b: 0 }
  colorWeight = 0
  colorBlendRate = 0.01

  move() {
    let proximityMult = 1
    const distance = Math.sqrt(
      Math.pow(this.pos.x - this.target.x, 2) +
      Math.pow(this.pos.y - this.target.y, 2)
    )
    if (distance < this.closeEnoughTarget) {
      proximityMult = distance / this.closeEnoughTarget
    }
    const towardsTarget = {
      x: this.target.x - this.pos.x,
      y: this.target.y - this.pos.y,
    }
    const magnitude = Math.sqrt(
      towardsTarget.x * towardsTarget.x + towardsTarget.y * towardsTarget.y
    )
    if (magnitude > 0) {
      towardsTarget.x = (towardsTarget.x / magnitude) * this.maxSpeed * proximityMult
      towardsTarget.y = (towardsTarget.y / magnitude) * this.maxSpeed * proximityMult
    }
    const steer = {
      x: towardsTarget.x - this.vel.x,
      y: towardsTarget.y - this.vel.y,
    }
    const steerMag = Math.sqrt(steer.x * steer.x + steer.y * steer.y)
    if (steerMag > 0) {
      steer.x = (steer.x / steerMag) * this.maxForce
      steer.y = (steer.y / steerMag) * this.maxForce
    }
    this.acc.x += steer.x
    this.acc.y += steer.y
    this.vel.x += this.acc.x
    this.vel.y += this.acc.y
    this.pos.x += this.vel.x
    this.pos.y += this.vel.y
    this.acc.x = 0
    this.acc.y = 0
  }

  draw(ctx: CanvasRenderingContext2D, drawAsPoints: boolean) {
    if (this.colorWeight < 1.0) {
      this.colorWeight = Math.min(this.colorWeight + this.colorBlendRate, 1.0)
    }
    const r = Math.round(this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight)
    const g = Math.round(this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight)
    const b = Math.round(this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight)

    if (drawAsPoints) {
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(this.pos.x, this.pos.y, 2, 2)
    } else {
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.beginPath()
      ctx.arc(this.pos.x, this.pos.y, this.particleSize / 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  kill(width: number, height: number) {
    if (!this.isKilled) {
      const p = this.generateRandomPos(width / 2, height / 2, (width + height) / 2)
      this.target.x = p.x
      this.target.y = p.y
      this.startColor = {
        r: this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight,
        g: this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight,
        b: this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight,
      }
      this.targetColor = { r: 0, g: 0, b: 0 }
      this.colorWeight = 0
      this.isKilled = true
    }
  }

  private generateRandomPos(x: number, y: number, mag: number): Vector2D {
    const rx = Math.random() * 1000
    const ry = Math.random() * 500
    const dir = { x: rx - x, y: ry - y }
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y)
    if (len > 0) { dir.x = (dir.x / len) * mag; dir.y = (dir.y / len) * mag }
    return { x: x + dir.x, y: y + dir.y }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function randomPos(x: number, y: number, mag: number): Vector2D {
  const rx = Math.random() * 1000
  const ry = Math.random() * 500
  const dir = { x: rx - x, y: ry - y }
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y)
  if (len > 0) { dir.x = (dir.x / len) * mag; dir.y = (dir.y / len) * mag }
  return { x: x + dir.x, y: y + dir.y }
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface ParticleTextEffectProps {
  words?: string[]
  /** CSS class for the outer wrapper */
  className?: string
  /** Hide the bottom hint label */
  showHint?: boolean
  /**
   * Fill the entire viewport — canvas resizes with the window.
   * Automatically scales font size to match.
   */
  fullScreen?: boolean
  /**
   * Called once when all `words` have been shown exactly one time each.
   * Useful for auto-advancing after the intro sequence.
   */
  onComplete?: () => void
}

const DEFAULT_WORDS = ["HELLO", "21st.dev", "ParticleTextEffect", "BY", "KAINXU"]
const FRAMES_PER_WORD = 240 // ≈ 4 s at 60 fps

// ─── Component ──────────────────────────────────────────────────────────────

export function ParticleTextEffect({
  words = DEFAULT_WORDS,
  className,
  showHint = true,
  fullScreen = false,
  onComplete,
}: ParticleTextEffectProps) {
  const canvasRef      = useRef<HTMLCanvasElement>(null)
  const animationRef   = useRef<number>()
  const particlesRef   = useRef<Particle[]>([])
  const frameCountRef  = useRef(0)
  const wordIndexRef   = useRef(0)
  const completedRef   = useRef(false)          // fire onComplete only once
  const onCompleteRef  = useRef(onComplete)
  const mouseRef       = useRef({ x: 0, y: 0, isPressed: false, isRightClick: false })

  // Keep callback ref fresh without restarting the effect
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  const pixelSteps  = 6
  const drawAsPoints = true

  // ── spawn / rearrange particles to form a word ──────────────────────────

  const spawnWord = useCallback((word: string, canvas: HTMLCanvasElement) => {
    const offscreen = document.createElement("canvas")
    offscreen.width  = canvas.width
    offscreen.height = canvas.height
    const octx = offscreen.getContext("2d")!

    // Scale font to canvas width so it always fills nicely
    const fontSize = Math.round(Math.min(canvas.width / 6.5, 160))
    octx.fillStyle    = "white"
    octx.font         = `bold ${fontSize}px Arial`
    octx.textAlign    = "center"
    octx.textBaseline = "middle"
    octx.fillText(word, canvas.width / 2, canvas.height / 2)

    const { data: pixels } = octx.getImageData(0, 0, canvas.width, canvas.height)
    const newColor = { r: Math.random() * 255, g: Math.random() * 255, b: Math.random() * 255 }

    const particles = particlesRef.current
    let pIdx = 0

    // Collect & shuffle pixel coords for fluid motion
    const coords: number[] = []
    for (let i = 0; i < pixels.length; i += pixelSteps * 4) coords.push(i)
    for (let i = coords.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[coords[i], coords[j]] = [coords[j], coords[i]]
    }

    for (const ci of coords) {
      if (pixels[ci + 3] === 0) continue
      const x = (ci / 4) % canvas.width
      const y = Math.floor(ci / 4 / canvas.width)

      let p: Particle
      if (pIdx < particles.length) {
        p = particles[pIdx]
        p.isKilled = false
        pIdx++
      } else {
        p = new Particle()
        const rp = randomPos(canvas.width / 2, canvas.height / 2, (canvas.width + canvas.height) / 2)
        p.pos.x = rp.x
        p.pos.y = rp.y
        p.maxSpeed      = Math.random() * 6 + 4
        p.maxForce      = p.maxSpeed * 0.05
        p.particleSize  = Math.random() * 6 + 6
        p.colorBlendRate = Math.random() * 0.0275 + 0.0025
        particles.push(p)
      }

      p.startColor = {
        r: p.startColor.r + (p.targetColor.r - p.startColor.r) * p.colorWeight,
        g: p.startColor.g + (p.targetColor.g - p.startColor.g) * p.colorWeight,
        b: p.startColor.b + (p.targetColor.b - p.startColor.b) * p.colorWeight,
      }
      p.targetColor  = newColor
      p.colorWeight  = 0
      p.target.x     = x
      p.target.y     = y
    }

    // Kill leftover particles from the previous word
    for (let i = pIdx; i < particles.length; i++) {
      particles[i].kill(canvas.width, canvas.height)
    }
  }, [pixelSteps])

  // ── animation loop ───────────────────────────────────────────────────────

  const animate = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx    = canvas.getContext("2d")!
    const parts  = particlesRef.current

    // Motion-blur background
    ctx.fillStyle = "rgba(0,0,0,0.1)"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.move()
      p.draw(ctx, drawAsPoints)
      if (p.isKilled && (p.pos.x < 0 || p.pos.x > canvas.width || p.pos.y < 0 || p.pos.y > canvas.height)) {
        parts.splice(i, 1)
      }
    }

    // Right-click destruction
    if (mouseRef.current.isPressed && mouseRef.current.isRightClick) {
      parts.forEach((p) => {
        const d = Math.sqrt(
          Math.pow(p.pos.x - mouseRef.current.x, 2) +
          Math.pow(p.pos.y - mouseRef.current.y, 2)
        )
        if (d < 50) p.kill(canvas.width, canvas.height)
      })
    }

    // Advance word every FRAMES_PER_WORD frames
    frameCountRef.current++
    if (frameCountRef.current % FRAMES_PER_WORD === 0) {
      const isLastWord = wordIndexRef.current === words.length - 1

      if (isLastWord && !completedRef.current) {
        completedRef.current = true
        onCompleteRef.current?.()
        // Keep animating (caller decides when to unmount)
      }

      wordIndexRef.current = (wordIndexRef.current + 1) % words.length
      spawnWord(words[wordIndexRef.current], canvas)
    }

    animationRef.current = requestAnimationFrame(animate)
  }, [words, spawnWord, drawAsPoints])

  // ── setup / teardown ─────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const setSize = () => {
      if (fullScreen) {
        canvas.width  = window.innerWidth
        canvas.height = window.innerHeight
      } else {
        canvas.width  = 1000
        canvas.height = 500
      }
    }

    setSize()
    completedRef.current = false
    wordIndexRef.current  = 0
    frameCountRef.current = 0
    particlesRef.current  = []

    spawnWord(words[0], canvas)
    animate()

    // Mouse handlers
    const down = (e: MouseEvent) => {
      mouseRef.current.isPressed     = true
      mouseRef.current.isRightClick  = e.button === 2
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = e.clientX - rect.left
      mouseRef.current.y = e.clientY - rect.top
    }
    const up   = () => { mouseRef.current.isPressed = false; mouseRef.current.isRightClick = false }
    const move = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = e.clientX - rect.left
      mouseRef.current.y = e.clientY - rect.top
    }
    const noCtx = (e: MouseEvent) => e.preventDefault()

    const resize = () => {
      if (!fullScreen) return
      setSize()
      // Re-spawn current word so particles reposition to the new layout
      spawnWord(words[wordIndexRef.current], canvas)
    }

    canvas.addEventListener("mousedown",    down)
    canvas.addEventListener("mouseup",      up)
    canvas.addEventListener("mousemove",    move)
    canvas.addEventListener("contextmenu",  noCtx)
    if (fullScreen) window.addEventListener("resize", resize)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      canvas.removeEventListener("mousedown",    down)
      canvas.removeEventListener("mouseup",      up)
      canvas.removeEventListener("mousemove",    move)
      canvas.removeEventListener("contextmenu",  noCtx)
      if (fullScreen) window.removeEventListener("resize", resize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── render ───────────────────────────────────────────────────────────────

  const wrapperClass = fullScreen
    ? "w-full h-full"
    : (className ?? "flex flex-col items-center justify-center min-h-screen bg-black p-4")

  return (
    <div className={wrapperClass}>
      <canvas
        ref={canvasRef}
        style={
          fullScreen
            ? { display: "block", width: "100%", height: "100%" }
            : { maxWidth: "100%", height: "auto" }
        }
        className={fullScreen ? undefined : "border border-gray-800 rounded-lg shadow-2xl"}
      />
      {showHint && !fullScreen && (
        <div className="mt-4 text-white text-sm text-center max-w-md">
          <p className="mb-2">Particle Text Effect</p>
          <p className="text-gray-400 text-xs">
            Right-click and hold to destroy particles · Words change every 4 s
          </p>
        </div>
      )}
    </div>
  )
}
