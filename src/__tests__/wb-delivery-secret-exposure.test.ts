import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

/**
 * The WB delivery code is a single-use, high-risk credential: it is the argument
 * to our own `receive` call and nothing else. docs/wb-dbs-delivery-plan.md §5
 * and §11 require that plaintext never reaches a list API.
 *
 * It did. `toDto` decrypted the secret for every row, and the overview endpoint
 * mapped all 150 orders through it — so a queue the client polls every 20
 * seconds shipped every live delivery code to the browser, for a screen that
 * never rendered them.
 */
describe("WB delivery secret exposure", () => {
  const workflow = read("src/lib/wb-delivery-workflow.ts");

  it("decrypts the delivery code behind an explicit opt-in", () => {
    // Exactly one decrypt site for the code, and it is guarded by the flag.
    const decryptSites = workflow.match(/decryptWbSecret\([^)]*"delivery-code"\)/g) ?? [];
    expect(decryptSites.length).toBeGreaterThan(0);
    expect(workflow).toMatch(/revealSecret && secretIsLive && order\.deliverySecret/);
  });

  it("never reveals the secret from the list loader", () => {
    const overview = workflow.slice(workflow.indexOf("export async function loadWbDeliveryOverview"));
    const body = overview.slice(0, overview.indexOf("\n}"));
    expect(body).not.toMatch(/revealSecret/);
  });

  it("reveals it only for a single explicitly opened order", () => {
    const single = workflow.slice(workflow.indexOf("export async function loadWbDeliveryOrder"));
    const body = single.slice(0, single.indexOf("\n}"));
    expect(body).toMatch(/revealSecret: true/);
  });

  it("keeps the queue payload free of chat and audit joins", () => {
    const listInclude = workflow.slice(
      workflow.indexOf("const listOrderInclude"),
      workflow.indexOf("const detailOrderInclude"),
    );
    // 150 orders x 80 chat events x 80 audit rows on a 20s poll is what this
    // separation exists to prevent.
    expect(listInclude).not.toMatch(/events:/);
  });
});
