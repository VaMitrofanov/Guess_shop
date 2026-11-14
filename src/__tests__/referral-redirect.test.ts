import { NextRequest } from "next/server";
import { GET } from "@/app/r/[code]/route";

describe("/r/<код>", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  test("redirects to the public site, not the container's internal origin", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://robloxbank.ru";
    process.env.AUTH_SECRET = "test-secret";
    const req = new NextRequest("https://0.0.0.0:3000/r/abc234xy");
    const res = await GET(req, { params: Promise.resolve({ code: "abc234xy" }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://robloxbank.ru/?ref=1#codes");
    expect(res.headers.get("set-cookie")).toMatch(/rb_ref=.+HttpOnly/i);
  });
});
