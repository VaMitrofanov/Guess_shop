import { isMailerConfigured, readMailerConfig, type MailerEnv } from "@/lib/mailer";

const base: MailerEnv = {
  SMTP_USER: "support@robloxbank.ru",
  SMTP_PASSWORD: "app-password",
};

describe("mailer configuration", () => {
  test("is unavailable until credentials are set, so nothing pretends to send", () => {
    expect(readMailerConfig({})).toBeNull();
    expect(isMailerConfigured({})).toBe(false);
  });

  test("treats a half-configured deploy as unconfigured", () => {
    // Missing password is the realistic mistake: the mailbox exists but the app
    // password was never added to the deploy env.
    expect(readMailerConfig({ SMTP_USER: "support@robloxbank.ru" })).toBeNull();
    expect(readMailerConfig({ SMTP_PASSWORD: "app-password" })).toBeNull();
  });

  test("ignores blank-but-present values", () => {
    expect(readMailerConfig({ SMTP_USER: "   ", SMTP_PASSWORD: "x" })).toBeNull();
    expect(readMailerConfig({ SMTP_USER: "x", SMTP_PASSWORD: "  " })).toBeNull();
  });

  test("defaults to Yandex implicit TLS for the robloxbank.ru mailbox", () => {
    expect(readMailerConfig(base)).toEqual({
      host: "smtp.yandex.ru",
      port: 465,
      user: "support@robloxbank.ru",
      password: "app-password",
      from: "support@robloxbank.ru",
    });
  });

  test("allows another provider without touching code", () => {
    const config = readMailerConfig({
      ...base,
      SMTP_HOST: "smtp.example.net",
      SMTP_PORT: "587",
      SMTP_FROM: "RobloxBank <no-reply@robloxbank.ru>",
    });

    expect(config).toMatchObject({
      host: "smtp.example.net",
      port: 587,
      from: "RobloxBank <no-reply@robloxbank.ru>",
    });
  });

  test("refuses a malformed port instead of silently falling back", () => {
    // A typo'd port must not quietly become 465 and send over the wrong channel.
    expect(readMailerConfig({ ...base, SMTP_PORT: "not-a-port" })).toBeNull();
    expect(readMailerConfig({ ...base, SMTP_PORT: "0" })).toBeNull();
    expect(readMailerConfig({ ...base, SMTP_PORT: "99999" })).toBeNull();
  });
});
