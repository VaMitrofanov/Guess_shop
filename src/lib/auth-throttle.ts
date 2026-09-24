import { rateLimit } from "@/lib/rate-limit";

/**
 * Throttle for password sign-in (docs/auth-account-readiness-plan.md, P0:
 * "нет отдельного throttling для password sign-in").
 *
 * Registration was already limited; the credentials provider was not, so a
 * password could be guessed at request speed. Two independent buckets:
 *
 *  - per IP, so a single host cannot sweep many accounts;
 *  - per normalized email, so a distributed attack cannot focus one account.
 *
 * The check runs BEFORE bcrypt deliberately. Verifying a password at cost 12
 * costs ~250ms of CPU, so an unthrottled sign-in is also a cheap CPU-exhaustion
 * vector against a 2-vCPU host — not only a credential-guessing one.
 *
 * Per-account limiting cuts both ways: it stops distributed credential stuffing
 * against one address, but a naive version lets an attacker lock a victim out by
 * burning their budget. Two properties keep that from happening:
 *
 *  - the IP bucket is the strict one and is charged first — it costs a victim
 *    nothing, since an attacker's traffic drains the attacker's own bucket;
 *  - the email bucket is deliberately larger than the IP bucket, so no single
 *    host can empty it. Draining it takes several cooperating hosts, and even
 *    then the bucket refills continuously — a targeted account is slowed, never
 *    locked out.
 */

export const SIGNIN_IP_CAPACITY = 10;
export const SIGNIN_IP_REFILL_PER_SEC = 0.2;
/** Must stay > SIGNIN_IP_CAPACITY: see the lockout note above. */
export const SIGNIN_EMAIL_CAPACITY = 20;
export const SIGNIN_EMAIL_REFILL_PER_SEC = 0.1;

/**
 * @param email Normalized (lowercased/trimmed) login email.
 * @param ip    Best-effort client IP from `clientIp()`.
 */
export function allowPasswordSignIn(email: string, ip: string): boolean {
  const perIp = rateLimit(`signin:ip:${ip}`, SIGNIN_IP_CAPACITY, SIGNIN_IP_REFILL_PER_SEC);
  if (!perIp.ok) return false;

  return rateLimit(`signin:email:${email}`, SIGNIN_EMAIL_CAPACITY, SIGNIN_EMAIL_REFILL_PER_SEC).ok;
}
