import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("TWA iOS input stability contract", () => {
  test("the route owns a permanent dark viewport underlay", () => {
    const layout = read("src/app/twa/layout.tsx");
    const css = read("src/app/globals.css");

    expect(layout).toContain('className="twa-route-host"');
    expect(layout).toContain("<TwaViewportGuard />");
    expect(css).toContain(".twa-route-host {");
    expect(css).toContain("background-color: #120f1c !important;");
    expect(css).toContain("background-image: none !important;");
  });

  test("all editable TWA controls are protected from iOS focus zoom", () => {
    const css = read("src/app/globals.css");

    expect(css).toContain('html.twa-route-active input:not([type="checkbox"])');
    expect(css).toContain("html.twa-route-active textarea");
    expect(css).toContain("font-size: 16px !important;");
  });

  test("visual viewport and native Telegram chrome stay synchronized", () => {
    const guard = read("src/app/twa/_components/TwaViewportGuard.tsx");
    const app = read("src/app/twa/_components/TwaApp.tsx");

    expect(guard).toContain("window.visualViewport");
    expect(guard).toContain('setProperty("--twa-visual-height"');
    expect(guard).toContain('document.addEventListener("focusout"');
    expect(app).toContain("wa.setHeaderColor?.(C.bg)");
    expect(app).toContain("wa.setBackgroundColor?.(C.bg)");
    expect(app).toContain("wa.setBottomBarColor?.(C.bg)");
  });
});
