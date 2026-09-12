import { getCheckoutGamepassDetails } from "@/lib/roblox";

describe("checkout gamepass resolution", () => {
  it("uses the owner's freshly listed public pass when direct detail APIs are unavailable", async () => {
    const gamepass = await getCheckoutGamepassDetails(
      "18831544",
      { id: 42, username: "KrytishVadim4ick" },
      {
        getDirect: async () => null,
        listOwned: async () => [
          { id: "other", name: "Other", price: 100, isForSale: true },
          { id: "18831544", name: "Purchase pass", price: 143, isForSale: true },
        ],
      },
    );

    expect(gamepass).toEqual({
      id: "18831544",
      name: "Purchase pass",
      price: 143,
      creatorId: 42,
      isActive: true,
    });
  });

  it("does not accept a pass absent from that owner's current public listing", async () => {
    const gamepass = await getCheckoutGamepassDetails(
      "18831544",
      { id: 42, username: "KrytishVadim4ick" },
      { getDirect: async () => null, listOwned: async () => [{ id: "different", isForSale: true }] },
    );

    expect(gamepass).toBeNull();
  });
});
