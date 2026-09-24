import { normalizeRobloxSecurityCookie } from "../lib/roblox-cookie";

describe("normalizeRobloxSecurityCookie", () => {
  const value = "_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_example";

  it("keeps a raw cookie value", () => {
    expect(normalizeRobloxSecurityCookie(`  ${value}  `)).toBe(value);
  });

  it("extracts .ROBLOSECURITY from a copied Cookie header", () => {
    expect(normalizeRobloxSecurityCookie(`foo=bar; .ROBLOSECURITY=${value}; theme=dark`)).toBe(value);
    expect(normalizeRobloxSecurityCookie(`Cookie: .ROBLOSECURITY=${value}; theme=dark`)).toBe(value);
  });

  it("removes wrapping quotes", () => {
    expect(normalizeRobloxSecurityCookie(`.ROBLOSECURITY=\"${value}\"`)).toBe(value);
  });
});
