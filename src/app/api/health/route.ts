/**
 * Liveness probe for the Docker/Coolify healthcheck.
 *
 * Must live under /api/* so it is never gated by the maintenance proxy
 * (src/proxy.ts excludes /api). Hitting the storefront root `/` for the
 * healthcheck breaks the container the moment MAINTENANCE_MODE=on, because
 * the proxy returns 503 there → Docker marks it unhealthy → Traefik pulls
 * the whole Web container (including /twa and /api) out of rotation.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
