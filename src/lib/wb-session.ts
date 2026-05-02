const WB_SESSION_KEY = "rb_wb_session";
const WB_SESSION_ID_KEY = "rb_wb_session_id";
const WB_SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface WBSession {
  denomination: number;
  code: string;
  ts: number;
}

export const getOrInitSessionId = (): string => {
  if (typeof window === "undefined") return "";
  let sessionId = localStorage.getItem(WB_SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(WB_SESSION_ID_KEY, sessionId);
  }
  return sessionId;
};

export const saveWBSession = (denomination: number, code: string) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WB_SESSION_KEY, JSON.stringify({ denomination, code, ts: Date.now() } satisfies WBSession));
  } catch {}
};

export const loadWBSession = (): { denomination: number; code: string } | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WB_SESSION_KEY);
    if (!raw) return null;
    const { denomination, code, ts } = JSON.parse(raw) as WBSession;
    if (Date.now() - ts > WB_SESSION_TTL) {
      localStorage.removeItem(WB_SESSION_KEY);
      return null;
    }
    return denomination > 0 ? { denomination, code: code ?? "" } : null;
  } catch {
    return null;
  }
};

export const clearWBSession = () => {
  if (typeof window !== "undefined") {
    localStorage.removeItem(WB_SESSION_KEY);
  }
};

