import {
  allowPasswordSignIn,
  SIGNIN_EMAIL_CAPACITY,
  SIGNIN_EMAIL_REFILL_PER_SEC,
  SIGNIN_IP_CAPACITY,
} from "@/lib/auth-throttle";

// The limiter is module-level state keyed by string, so every test uses its own
// unique identities (same approach as rate-limit.test.ts).
const uniq = (label: string) => `${label}-${Date.now()}-${Math.random()}`;

describe("password sign-in throttling", () => {
  test("blocks a single host once its IP budget is spent", () => {
    const email = uniq("buyer@example.ru");
    const ip = uniq("203.0.113");

    for (let i = 0; i < SIGNIN_IP_CAPACITY; i += 1) {
      expect(allowPasswordSignIn(email, ip)).toBe(true);
    }
    expect(allowPasswordSignIn(email, ip)).toBe(false);
  });

  test("keeps the email budget larger than one host can drain", () => {
    // The lockout guarantee below depends on this ordering, so pin it here:
    // if someone lowers the email capacity to the IP capacity, one attacker
    // could empty a victim's bucket again.
    expect(SIGNIN_EMAIL_CAPACITY).toBeGreaterThan(SIGNIN_IP_CAPACITY);
    expect(SIGNIN_EMAIL_REFILL_PER_SEC).toBeGreaterThan(0);
  });

  test("stops one host from sweeping many different accounts", () => {
    const ip = uniq("198.51.100");

    // Each attempt targets a fresh email, so only the IP bucket can stop this.
    let allowed = 0;
    for (let i = 0; i < SIGNIN_IP_CAPACITY + 5; i += 1) {
      if (allowPasswordSignIn(uniq("victim@example.ru"), ip)) allowed += 1;
    }
    expect(allowed).toBe(SIGNIN_IP_CAPACITY);
  });

  test("does not let one abusive host lock a victim out from other hosts", () => {
    const victim = uniq("victim@example.ru");
    const attackerIp = uniq("192.0.2");

    // Attacker exhausts its own IP bucket against the victim's address.
    for (let i = 0; i < SIGNIN_IP_CAPACITY + 5; i += 1) {
      allowPasswordSignIn(victim, attackerIp);
    }
    expect(allowPasswordSignIn(victim, attackerIp)).toBe(false);

    // The victim, arriving from their own IP, must still be able to sign in.
    // This only holds because the email bucket is charged after the IP bucket
    // passes — otherwise the attacker would have drained it too.
    expect(allowPasswordSignIn(victim, uniq("203.0.113"))).toBe(true);
  });

  test("keeps separate accounts on one IP independent until the IP budget runs out", () => {
    const ip = uniq("203.0.113");
    const first = uniq("a@example.ru");
    const second = uniq("b@example.ru");

    expect(allowPasswordSignIn(first, ip)).toBe(true);
    expect(allowPasswordSignIn(second, ip)).toBe(true);
  });
});
