import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

const HETZNER_API = "https://api.hetzner.cloud/v1";
const VDSINA_BASE = "https://api2.vdsina.ru";

interface ServiceCheck {
  name: string;
  icon: string;
  ok: boolean;
  ms: number;
}

interface HetznerServer {
  name: string;
  status: string;
  city: string;
  cores: number;
  memory: number;
  monthlyEur: number;
}

interface ServerProvider {
  provider: string;
  balance?: number;
  currency?: string;
  daysLeft?: number;
  monthlyEur?: number;
  daysUntilBill?: number;
  servers?: HetznerServer[];
}

interface NeonStats {
  sizeMB: number;
  orderCount: number;
  unusedCodes: number;
  activeConnections: number;
  daysUntilBill: number;
  nextBillDate: string;
}

async function checkService(name: string, url: string, icon: string): Promise<ServiceCheck> {
  if (!url) return { name, icon, ok: false, ms: 0 };
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const isOk = res.ok || (res.status === 404 && url.includes(":3000"));
    return { name, icon, ok: isOk, ms: Date.now() - start };
  } catch {
    return { name, icon, ok: false, ms: Date.now() - start };
  }
}

async function fetchHetzner(): Promise<ServerProvider | null> {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${HETZNER_API}/servers?per_page=50`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const servers: HetznerServer[] = (data.servers ?? []).map((s: any) => {
      const dcLoc = s.datacenter?.location?.name;
      const price = s.server_type?.prices?.find((p: any) => p.location === dcLoc) ?? s.server_type?.prices?.[0];
      return {
        name: s.name,
        status: s.status,
        city: s.datacenter?.location?.city ?? "?",
        cores: s.server_type?.cores ?? 0,
        memory: s.server_type?.memory ?? 0,
        monthlyEur: price ? parseFloat(price.price_monthly.gross) : 0,
      };
    });
    const totalEur = servers.reduce((a, s) => a + s.monthlyEur, 0);
    const now = new Date();
    const nextBill = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const daysUntilBill = Math.ceil((nextBill.getTime() - now.getTime()) / 86_400_000);
    return { provider: "hetzner", monthlyEur: totalEur, daysUntilBill, servers };
  } catch {
    return null;
  }
}

async function fetchVdsina(): Promise<ServerProvider | null> {
  const email = process.env.VDSINA_EMAIL;
  const password = process.env.VDSINA_PASSWORD;
  if (!email || !password) return null;
  try {
    const r1 = await fetch(`${VDSINA_BASE}/login`, {
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Origin: "https://cp.vdsina.ru", Referer: "https://cp.vdsina.ru/" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r1.ok) return null;
    const d1 = (await r1.json()) as any;
    const csrf = d1._csrf as string | undefined;
    if (!csrf) return null;

    const rawCookies: Record<string, string> = {};
    r1.headers.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") {
        const name = v.split("=")[0].trim();
        const val = v.split("=").slice(1).join("=").split(";")[0].trim();
        rawCookies[name] = val;
      }
    });
    const cookieStr = Object.entries(rawCookies).map(([k, v]) => `${k}=${v}`).join("; ");

    const r2 = await fetch(`${VDSINA_BASE}/login`, {
      method: "POST",
      headers: {
        Accept: "application/json", "X-Requested-With": "XMLHttpRequest",
        Origin: "https://cp.vdsina.ru", Referer: "https://cp.vdsina.ru/",
        "Content-Type": "application/json", Cookie: cookieStr, "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({ email, password, _csrf: csrf, remember_me: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r2.ok) return null;
    const d2 = (await r2.json()) as any;
    if (d2.status !== "ok" && d2.status !== "success") return null;
    const session = d2._session;
    if (!session) return null;

    const r3 = await fetch(`${VDSINA_BASE}/account/view`, {
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Cookie: `_session=${session}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r3.ok) return null;
    const d3 = (await r3.json()) as any;
    const obj = d3.data ?? d3.result ?? d3;
    const balance = parseFloat(obj.balance ?? obj.credit ?? "0");
    const monthly = parseFloat(process.env.VDSINA_MONTHLY_COST ?? "0");
    const daysLeft = monthly > 0 ? Math.floor(balance / (monthly / 30)) : undefined;
    return { provider: "vdsina", balance, currency: "₽", daysLeft };
  } catch {
    return null;
  }
}

async function fetchNeonStats(): Promise<NeonStats | null> {
  try {
    const result: any[] = await (prisma as any).$queryRaw`
      SELECT
        pg_database_size(current_database()) AS size_bytes,
        (SELECT count(*) FROM "WbOrder") AS order_count,
        (SELECT count(*) FROM "WbCode" WHERE "isUsed" = false) AS unused_codes,
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS active_connections
    `;
    const row = result[0];
    const sizeMB = Number(BigInt(row.size_bytes ?? 0)) / (1024 ** 2);
    const billingDay = parseInt(process.env.NEON_BILLING_DAY ?? "1");
    const now = new Date();
    let nextBillDate = new Date(now.getFullYear(), now.getMonth(), billingDay);
    if (nextBillDate.getTime() <= now.getTime()) {
      nextBillDate = new Date(now.getFullYear(), now.getMonth() + 1, billingDay);
    }
    const daysUntilBill = Math.ceil((nextBillDate.getTime() - now.getTime()) / 86_400_000);
    return {
      sizeMB: Math.round(sizeMB * 10) / 10,
      orderCount: Number(BigInt(row.order_count ?? 0)),
      unusedCodes: Number(BigInt(row.unused_codes ?? 0)),
      activeConnections: Number(BigInt(row.active_connections ?? 0)),
      daysUntilBill,
      nextBillDate: nextBillDate.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const services: Promise<ServiceCheck>[] = [
    checkService("Web", process.env.MAIN_HEALTH_URL ?? "https://www.robloxbank.ru", "web"),
    checkService("Guide", process.env.GUIDE_HEALTH_URL ?? "https://www.robloxbank.ru/guide", "web"),
    checkService("VK Bot", process.env.VK_BOT_HEALTH_URL ?? "http://5.223.95.11:3000", "bot"),
    checkService("TG Bot", process.env.TG_BOT_HEALTH_URL ?? "http://5.223.95.11:3000", "bot"),
  ];

  const [serviceResults, hetzner, vdsina, neon, lastOrder] = await Promise.all([
    Promise.all(services),
    fetchHetzner(),
    fetchVdsina(),
    fetchNeonStats(),
    (prisma as any).wbOrder.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const lastOrderAgo = lastOrder
    ? Math.floor((Date.now() - new Date(lastOrder.createdAt).getTime()) / 60_000)
    : null;

  const providers: ServerProvider[] = [];
  if (hetzner) providers.push(hetzner);
  if (vdsina) providers.push(vdsina);

  return NextResponse.json({
    services: serviceResults,
    providers,
    neon,
    lastOrderMinAgo: lastOrderAgo,
  });
}
