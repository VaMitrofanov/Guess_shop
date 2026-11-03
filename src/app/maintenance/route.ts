/**
 * Maintenance page — served via rewrite from src/proxy.ts when
 * MAINTENANCE_MODE=on (see docs/deploy.md, «Режим техработ»).
 *
 * A route handler instead of a page.tsx: pages can't control the HTTP
 * status, and the custom status passed to NextResponse.rewrite() in the
 * proxy is ignored by the production server — the destination's own
 * response wins. Here we own the response, so the 503 is guaranteed.
 */

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Технические работы — Roblox Bank</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background-color: #0a0e1a;
    background-image:
      radial-gradient(ellipse 70% 40% at 50% -5%, rgba(0,176,111,0.08) 0%, transparent 55%),
      radial-gradient(ellipse 50% 30% at 100% 20%, rgba(88,101,242,0.05) 0%, transparent 50%);
    color: #eef2ff;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
  }
  .card {
    background: rgba(15, 21, 40, 0.8);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 16px;
    padding: 48px 32px;
    max-width: 420px;
    width: 100%;
    text-align: center;
  }
  .icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 24px;
    border-radius: 16px;
    background: linear-gradient(135deg, #00b06f 0%, #00d084 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    animation: float 3s ease-in-out infinite;
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }
  .tag {
    font-family: ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    color: #00b06f;
    margin-bottom: 16px;
  }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 12px; }
  p { font-size: 15px; color: #97a0bd; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🛠️</div>
    <div class="tag">MAINTENANCE</div>
    <h1>Ведутся технические работы</h1>
    <p>Сайт временно недоступен — мы обновляем сервис, чтобы стало ещё удобнее. Загляните чуть позже.</p>
  </div>
</body>
</html>`;

export function GET() {
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "3600",
      "cache-control": "no-store",
    },
  });
}
