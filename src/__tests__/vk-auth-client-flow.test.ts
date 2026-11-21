import { readFileSync } from "fs";
import path from "path";

describe("VK ID client flow regression", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "components", "auth", "VKAuthButton.tsx"),
    "utf8",
  );

  test("uses the official bundled SDK and a direct popup login", () => {
    expect(source).toContain('from "@vkid/sdk"');
    expect(source).toContain("VKID.ConfigAuthMode.InNewWindow");
    expect(source).toContain("VKID.Auth.login(");
  });

  test("does not restore the hidden OneTap iframe bridge", () => {
    expect(source).not.toContain("new VKID.OneTap");
    expect(source).not.toContain("vk-auth-widget--ghost");
    expect(source).not.toContain("target.click()");
  });
});
