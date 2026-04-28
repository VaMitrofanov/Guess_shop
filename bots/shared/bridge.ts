/**
 * Validation Bridge — HTTP server
 *
 * Runs on the Singapore instance. Accepts Roblox gamepass validation requests
 * from Russia-based bots that cannot reach Roblox APIs directly.
 *
 * Endpoint:
 *   GET /check-pass?id=<ASSET_ID>
 *   Header: x-validator-key: <VALIDATOR_KEY>
 *
 * Response:
 *   200 { ok: true,  data: GamepassDetails | null }
 *   400 { ok: false, error: "invalid_id" | "bad_request" }
 *   401 { ok: false, error: "unauthorized" }
 *   404 { ok: false, error: "not_found" }
 *   500 { ok: false, error: "server_error" }
 *
 * Uses getGamepassDetailsDirect() — bypasses the VALIDATOR_SOURCE_URL branch
 * to prevent infinite recursion if this server also has that var set.
 */

import * as http from "http";
import { getGamepassDetailsDirect } from "./roblox";

// Allow overriding port via env for cases where 3000 is already in use
const BRIDGE_PORT = parseInt(process.env.VALIDATOR_PORT ?? "3000", 10);

export function startBridgeServer(): http.Server {
  const expectedKey = process.env.VALIDATOR_KEY?.trim();

  const server = http.createServer(async (req, res) => {
    const respond = (status: number, body: object): void => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    // Parse URL
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      respond(400, { ok: false, error: "bad_request" });
      return;
    }

    // ── Route dispatcher ────────────────────────────────────────────────────
    const isCheckPass = req.method === "GET"  && url.pathname === "/check-pass";
    const isTgProxy   = req.method === "POST" && url.pathname === "/tg-proxy";

    if (!isCheckPass && !isTgProxy) {
      respond(404, { ok: false, error: "not_found" });
      return;
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    if (expectedKey) {
      const provided = req.headers["x-validator-key"];
      if (provided !== expectedKey) {
        console.warn(
          `[Bridge] Unauthorized request from ${req.socket.remoteAddress} ` +
          `— key mismatch (provided: ${provided ? "set" : "missing"})`
        );
        respond(401, { ok: false, error: "unauthorized" });
        return;
      }
    }

    // ── POST /tg-proxy ──────────────────────────────────────────────────────
    // Accepts any Telegram Bot API call. Required fields: token, chat_id.
    // Optional 'method' overrides the TG method (default: auto-detect).
    // All other fields are forwarded verbatim (text, photo, caption,
    // reply_markup, inline_keyboard, etc.).
    if (isTgProxy) {
      let body: Record<string, unknown>;
      try {
        const raw = await new Promise<string>((resolve, reject) => {
          let data = "";
          req.on("data", (chunk) => { data += chunk; });
          req.on("end",  () => resolve(data));
          req.on("error", reject);
        });
        body = JSON.parse(raw);
      } catch {
        respond(400, { ok: false, error: "bad_request" });
        return;
      }

      const { token, method: tgMethod, chat_id, ...rest } = body as any;
      if (!token || !chat_id) {
        respond(400, { ok: false, error: "missing_fields" });
        return;
      }

      // Auto-detect method if not explicitly provided
      const resolvedMethod: string =
        typeof tgMethod === "string" ? tgMethod :
        rest.photo                  ? "sendPhoto" :
                                      "sendMessage";

      if (resolvedMethod === "sendMessage" && !rest.text) {
        respond(400, { ok: false, error: "missing_fields" });
        return;
      }

      console.log(`[Bridge] Routing ${resolvedMethod} to chat ${chat_id}`);

      try {
        const tgRes = await fetch(
          `https://api.telegram.org/bot${token}/${resolvedMethod}`,
          {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            // parse_mode default; individual callers can override via rest
            body:    JSON.stringify({ parse_mode: "HTML", ...rest, chat_id }),
          }
        );
        const tgBody = await tgRes.json();
        if (!tgRes.ok) {
          // Suppress "chat not found" noise from stale admin IDs
          const desc: string = (tgBody as any)?.description ?? "";
          if (tgRes.status === 400 && desc.includes("chat not found")) {
            respond(200, { ok: true, warning: "chat_not_found" });
            return;
          }
          console.error(
            `[Bridge/tg-proxy] TG error for chat_id=${chat_id} ` +
            `method=${resolvedMethod}: HTTP ${tgRes.status}`,
            tgBody
          );
          respond(502, { ok: false, error: "tg_error", detail: tgBody });
          return;
        }
        console.log(`[Bridge/tg-proxy] → chat_id=${chat_id} method=${resolvedMethod} delivered`);
        respond(200, { ok: true });
      } catch (err: any) {
        console.error("[Bridge/tg-proxy] fetch failed:", err?.message ?? err);
        respond(502, { ok: false, error: "tg_unreachable" });
      }
      return;
    }

    // ── GET /check-pass ─────────────────────────────────────────────────────
    // ── Validate asset ID ───────────────────────────────────────────────────
    const passId = url.searchParams.get("id") ?? "";
    if (!passId || !/^\d{1,20}$/.test(passId)) {
      respond(400, { ok: false, error: "invalid_id" });
      return;
    }

    console.log(`[Bridge] → Validating gamepass id=${passId}`);

    // ── Call Roblox directly (no bridge recursion) ──────────────────────────
    try {
      const details = await getGamepassDetailsDirect(passId);
      console.log(
        `[Bridge] ← id=${passId}: ` +
        (details
          ? `"${details.name}" price=${details.price} active=${details.isActive}` +
            (details.validationSkipped ? " [SKIPPED]" : "")
          : "null (not found)")
      );
      respond(200, { ok: true, data: details });
    } catch (err: any) {
      console.error(`[Bridge] Error for id=${passId}:`, err?.message ?? err);
      respond(500, { ok: false, error: "server_error" });
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[Bridge] Port ${BRIDGE_PORT} is already in use. ` +
        `Set VALIDATOR_PORT to a different value or free the port.`
      );
    } else {
      console.error("[Bridge] Server error:", err);
    }
  });

  server.listen(BRIDGE_PORT, "0.0.0.0", () => {
    console.log(`[Bridge] Validation server listening on 0.0.0.0:${BRIDGE_PORT}`);
    if (!expectedKey) {
      console.warn(
        "[Bridge] ⚠️  VALIDATOR_KEY is not set — endpoint is UNPROTECTED. " +
        "Set VALIDATOR_KEY in Coolify env vars immediately."
      );
    }
  });

  return server;
}
