const findMany = jest.fn();
const sendMail = jest.fn();

jest.mock("@/lib/prisma", () => ({ prisma: { user: { findMany } } }));
jest.mock("@/lib/mailer", () => ({ sendMail }));

import { POST } from "@/app/api/internal/worker-alert/route";

function request(key: string, body: unknown) {
  return new Request("http://localhost/api/internal/worker-alert", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-worker-alert-key": key },
    body: JSON.stringify(body),
  }) as never;
}

describe("internal worker alert email fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VALIDATOR_KEY = "secret";
    process.env.ADMIN_IDS = "111,222";
    findMany.mockResolvedValue([{ email: "owner@example.com" }]);
    sendMail.mockResolvedValue({ ok: true });
  });

  test("rejects a request without the shared key", async () => {
    const response = await POST(request("wrong", { kind: "worker_stale", text: "stale" }));
    expect(response.status).toBe(401);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("emails only verified owners linked to an admin TG identity", async () => {
    const response = await POST(request("secret", {
      kind: "worker_stale",
      text: "🚨 <b>PAYMENT WORKER ОСТАНОВЛЕН</b>",
    }));
    expect(response.status).toBe(202);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ emailVerifiedAt: { not: null } }),
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@example.com",
      subject: expect.stringContaining("остановлен"),
      text: expect.not.stringContaining("<b>"),
    }));
  });
});
