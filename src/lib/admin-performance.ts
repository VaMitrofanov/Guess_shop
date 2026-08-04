import "server-only";

export function logAdminTiming(route: string, startedAt: number, fields: Record<string, number | string> = {}) {
  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  console.info(JSON.stringify({
    event: "admin-performance",
    route,
    durationMs,
    ...fields,
  }));
  return durationMs;
}
