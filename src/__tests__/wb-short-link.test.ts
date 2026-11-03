/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/wb/[...slug]/route";
import { repairEscapedQuery } from "@/lib/escaped-query";

/**
 * С 16.09.2026 WB экранирует текст чата: `&` доходит до покупателя как
 * `&amp;`, и ссылка гейта теряла код. Новые ссылки — `/wb/<код>` без `&`;
 * уже отправленные чинит страница гайда.
 */
async function open(path: string) {
  const res = await GET(new NextRequest(`http://0.0.0.0:3001${path}`), {
    params: Promise.resolve({ slug: path.split("?")[0].replace(/^\/wb\//, "").split("/") }),
  });
  return { status: res.status, location: res.headers.get("location") };
}

describe("короткая ссылка гейта /wb/<код>", () => {
  it("разворачивается в полный адрес гайда на публичном домене", async () => {
    const { status, location } = await open("/wb/QUN5YFZ");
    expect(status).toBe(307);
    expect(location).toBe("https://robloxbank.ru/guide?source=wb&skip=1&code=QUN5YFZ");
  });

  it("несёт ветку ключа сегментом и ник единственным параметром", async () => {
    const { location } = await open("/wb/qun5yfz/key?u=hidden_inv_buyer");
    expect(location).toBe("https://robloxbank.ru/guide?source=wb&skip=1&code=QUN5YFZ&username=hidden_inv_buyer&stage=key");
  });

  it("мусор вместо кода ведёт в гайд, где код вводят руками", async () => {
    const { location } = await open("/wb/привет");
    expect(location).toBe("https://robloxbank.ru/guide?source=wb");
  });

  it("кривой ник в ссылку не попадает", async () => {
    const { location } = await open("/wb/QUN5YFZ?u=<script>");
    expect(location).toBe("https://robloxbank.ru/guide?source=wb&skip=1&code=QUN5YFZ");
  });
});

describe("repairEscapedQuery — уже отправленные ссылки с &amp;", () => {
  it("снимает префикс amp; с имён параметров", () => {
    expect(repairEscapedQuery({ source: "wb", "amp;skip": "1", "amp;code": "B55UVT8" }))
      .toBe("source=wb&skip=1&code=B55UVT8");
  });

  it("чистый адрес не трогает", () => {
    expect(repairEscapedQuery({ source: "wb", skip: "1", code: "B55UVT8" })).toBeNull();
  });

  it("двойное экранирование тоже чинится", () => {
    expect(repairEscapedQuery({ source: "wb", "amp;amp;code": "B55UVT8" })).toBe("source=wb&code=B55UVT8");
  });
});
