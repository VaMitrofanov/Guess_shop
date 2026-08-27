/**
 * Validation Bridge — HTTP server
 *
 * Runs on the Singapore instance. Accepts Roblox gamepass validation requests
 * from Russia-based bots that cannot reach Roblox APIs directly.
 *
 * Endpoints:
 *   GET  /check-pass?id=<ASSET_ID>
 *   GET  /gamepass-by-id?id=<ASSET_ID>
 *   GET  /roblox-user?username=<NICK> | ?userId=<ID>
 *   POST /search-gamepasses  { username }
 *   POST /tg-proxy
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
import {
  getGamepassDetailsDirect,
  getGamepassForPurchase,
  getRobloxUserProfileDirect,
  searchGamepassesByNickDirect,
} from "./roblox";

/** What the bridge hands back to the caller after a Telegram call.
 *
 * Read-only community methods return their data verbatim — that is the whole
 * point of the call. Sends return one field: `message_id`. It is a handle, not
 * payload — but without it a caller can never edit what it sent, and that is
 * exactly how one DBS order came to produce three identical admin cards: the
 * live card looked up an id it had no way of learning, found none, and sent a
 * fresh message every time. Message text, chat and sender stay off the wire. */
export function telegramProxySuccessPayload(method: string, result: unknown) {
  if (method === "getChat" || method === "getChatMemberCount") return { ok: true, result };
  if (method === "sendMessage" || method === "sendPhoto") {
    const messageId = (result as { message_id?: unknown } | null)?.message_id;
    if (typeof messageId === "number") return { ok: true, result: { message_id: messageId } };
  }
  return { ok: true };
}

/** Telegram refuses an edit whose text is identical to what the message already
 * shows. For a card that is success — the card is correct — but it arrives as
 * HTTP 400, and a caller that reads it as failure falls back to sending, which
 * is the duplicate. Answered as success so it never becomes one.
 *
 * Deliberately narrow: "message to edit not found" stays a failure, because
 * there the message really is gone and the caller does need to send a new one. */
function isBenignTelegramRefusal(status: number, description: string): boolean {
  if (status !== 400) return false;
  return /message is not modified/i.test(description)
    || /message to delete not found/i.test(description);
}

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
    const isCheckPass        = req.method === "GET"  && url.pathname === "/check-pass";
    const isTgProxy          = req.method === "POST" && url.pathname === "/tg-proxy";
    const isSearchGamepasses = req.method === "POST" && url.pathname === "/search-gamepasses";
    const isGamepassById     = req.method === "GET"  && url.pathname === "/gamepass-by-id";
    const isRobloxUser       = req.method === "GET"  && url.pathname === "/roblox-user";

    if (!isCheckPass && !isTgProxy && !isSearchGamepasses && !isGamepassById && !isRobloxUser) {
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
    // Accepts any Telegram Bot API call. Required field: chat_id. The bot token
    // stays on the SG bridge and is never accepted from callers.
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

      const { method: tgMethod, chat_id, ...rest } = body;
      const token = process.env.TG_TOKEN;
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
        const tgBody = await tgRes.json() as { description?: string; result?: unknown };
        if (!tgRes.ok) {
          // Suppress "chat not found" noise from stale admin IDs
          const desc = tgBody.description ?? "";
          if (tgRes.status === 400 && desc.includes("chat not found")) {
            respond(200, { ok: true, warning: "chat_not_found" });
            return;
          }
          if (isBenignTelegramRefusal(tgRes.status, desc)) {
            respond(200, { ok: true, warning: "no_change" });
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
        // Read-only calls power server-side operational metrics on the RF Web
        // host, which cannot reach api.telegram.org directly. Do not widen the
        // response for send methods: message/chat payloads are unnecessary there.
        respond(200, telegramProxySuccessPayload(resolvedMethod, tgBody.result));
      } catch (err: any) {
        console.error("[Bridge/tg-proxy] fetch failed:", err?.message ?? err);
        respond(502, { ok: false, error: "tg_unreachable" });
      }
      return;
    }

    // ── POST /search-gamepasses ─────────────────────────────────────────────
    if (isSearchGamepasses) {
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

      const username = typeof body.username === "string" ? body.username.trim() : "";
      if (!username) {
        respond(400, { ok: false, error: "missing_username" });
        return;
      }

      console.log(`[Bridge] → Searching gamepasses for username="${username}"`);
      try {
        const { account, gamepasses } = await searchGamepassesByNickDirect(username);
        console.log(
          `[Bridge] ← "${username}": ` +
          (account ? `id=${account.id}, ${gamepasses.length} gamepass(es)` : "no such Roblox account")
        );
        // `gamepasses` stays the first field older callers read. `account` and
        // `userExists` are additive: a caller on the RF side needs them to tell
        // a mistyped nick from a real account whose place is hidden, and to draw
        // the account card without a second Roblox round trip it cannot make.
        respond(200, { ok: true, gamepasses, userExists: account !== null, account });
      } catch (err: any) {
        console.error(`[Bridge] search-gamepasses error for "${username}":`, err?.message ?? err);
        respond(500, { ok: false, error: "server_error" });
      }
      return;
    }

    // ── GET /roblox-user ────────────────────────────────────────────────────
    // Account card (id, canonical nick, display name, headshot) by nick or id.
    if (isRobloxUser) {
      const username = (url.searchParams.get("username") ?? "").trim();
      const userId   = (url.searchParams.get("userId") ?? "").trim();
      if (!username && !userId) {
        respond(400, { ok: false, error: "missing_username" });
        return;
      }
      if (userId && !/^\d{1,20}$/.test(userId)) {
        respond(400, { ok: false, error: "invalid_id" });
        return;
      }
      try {
        const user = await getRobloxUserProfileDirect(userId ? { userId } : { username });
        console.log(`[Bridge] ← roblox-user ${userId || username}: ${user ? user.name : "not found"}`);
        respond(200, { ok: true, user });
      } catch (err: any) {
        console.error(`[Bridge] roblox-user error for "${userId || username}":`, err?.message ?? err);
        respond(500, { ok: false, error: "server_error" });
      }
      return;
    }

    // ── GET /gamepass-by-id ─────────────────────────────────────────────────
    if (isGamepassById) {
      const gpId = url.searchParams.get("id") ?? "";
      if (!gpId || !/^\d{1,20}$/.test(gpId)) {
        respond(400, { ok: false, error: "invalid_id" });
        return;
      }
      console.log(`[Bridge] → Lookup gamepass-by-id id=${gpId}`);
      try {
        // Two different questions, asked together because the caller behind the
        // bridge needs both and cannot ask Roblox itself: the universe walk
        // gives placeId/productId/thumbnail for a buyout, product-info gives
        // sale state and owner id — the pair the manual-link entry checks before
        // it lets a buyer pay. `details` is additive; `gamepass` is unchanged.
        const [gp, details] = await Promise.all([
          getGamepassForPurchase(gpId),
          getGamepassDetailsDirect(gpId).catch(() => null),
        ]);
        console.log(`[Bridge] ← id=${gpId}: ${gp ? `"${gp.name}" ${gp.robux}R$` : "not found"}`);
        respond(200, { ok: true, gamepass: gp, details });
      } catch (err: any) {
        console.error(`[Bridge] gamepass-by-id error for id=${gpId}:`, err?.message ?? err);
        respond(500, { ok: false, error: "server_error" });
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
      // Log as error so it's impossible to miss in Coolify/PM2 logs.
      // The server still starts so the bot doesn't crash, but any operator
      // reading the logs will see this immediately.
      console.error(
        "[Bridge] *** SECURITY: VALIDATOR_KEY is not set — /check-pass and /tg-proxy " +
        "are COMPLETELY UNPROTECTED. Anyone who knows this IP can send Telegram messages " +
        "or query gamepasses. Set VALIDATOR_KEY in Coolify env vars immediately. ***"
      );
    }
  });

  return server;
}
