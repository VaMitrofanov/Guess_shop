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

    // Only serve GET /check-pass
    if (req.method !== "GET" || url.pathname !== "/check-pass") {
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
