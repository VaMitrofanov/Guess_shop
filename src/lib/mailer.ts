import nodemailer, { type Transporter } from "nodemailer";

/**
 * Transactional email for the account lifecycle (verification, password reset).
 *
 * Fail-closed by design: with no SMTP credentials configured the module reports
 * itself unavailable and refuses to send, rather than throwing deep inside a
 * request or — worse — silently pretending a reset link went out. A caller must
 * check `isMailerConfigured()` and tell the user the truth when it is false.
 *
 * Credentials live only in the deploy env (Coolify). The repository is public:
 * nothing here may carry a default password, and no send path may log the
 * password, the recipient's address or a token.
 *
 * Provider: Brevo SMTP relay for the robloxbank.ru domain. The relay uses the
 * non-standard port 2525 available on the VPS; swapping providers means changing
 * deploy env only, with no caller importing nodemailer directly.
 */

export interface MailerConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Environment source. `process.env` satisfies this, and a test can pass a plain
 * object without pulling in the whole `ProcessEnv` shape.
 *
 * Keys read: `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT`.
 */
export type MailerEnv = Record<string, string | undefined>;

const DEFAULT_HOST = "smtp.yandex.ru";
const DEFAULT_PORT = 465;

/**
 * Reads SMTP settings from the environment.
 *
 * Returns null when anything required is missing or blank, so a half-configured
 * deploy behaves exactly like an unconfigured one instead of failing later at
 * an unpredictable point.
 */
export function readMailerConfig(env: MailerEnv = process.env): MailerConfig | null {
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  if (!user || !password) return null;

  const from = env.SMTP_FROM?.trim() || user;
  const host = env.SMTP_HOST?.trim() || DEFAULT_HOST;

  const rawPort = env.SMTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  return { host, port, user, password, from };
}

export function isMailerConfigured(env: MailerEnv = process.env): boolean {
  return readMailerConfig(env) !== null;
}

let cached: Transporter | null = null;

function transporter(config: MailerConfig): Transporter {
  if (!cached) {
    cached = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // 465 is implicit TLS; anything else upgrades via STARTTLS.
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });
  }
  return cached;
}

/** Test seam: drop the memoized transport so a new config is picked up. */
export function resetMailerForTests(): void {
  cached = null;
}

export type SendResult = { ok: true } | { ok: false; reason: "not_configured" | "send_failed" };

/**
 * Sends one transactional message.
 *
 * Never throws: callers are auth routes where an unhandled rejection would turn
 * into a 500 that leaks whether an address exists. Failures come back as a
 * value, and the error is logged without the recipient or the message body.
 */
export async function sendMail(message: MailMessage): Promise<SendResult> {
  const config = readMailerConfig();
  if (!config) {
    console.warn("[mailer] SMTP is not configured — refusing to send");
    return { ok: false, reason: "not_configured" };
  }

  try {
    await transporter(config).sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    return { ok: true };
  } catch (error) {
    // Log the class of failure only. The address is personal data and the body
    // may carry a one-time token.
    console.error("[mailer] send failed:", (error as Error)?.message ?? "unknown error");
    return { ok: false, reason: "send_failed" };
  }
}
