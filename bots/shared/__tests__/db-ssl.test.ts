/** TLS к базе: Neon как раньше, свой Postgres — по нашему CA. */
import { dbConnectionConfig } from "../db-ssl";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

describe("dbConnectionConfig", () => {
  it("Neon без DATABASE_CA — как раньше: require → verify-full, без объекта ssl", () => {
    const c = dbConnectionConfig("postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require", {});
    expect(c.connectionString).toContain("sslmode=verify-full");
    expect(c.ssl).toBeUndefined();
  });

  it("правка URL (пулер сайта) применяется", () => {
    const c = dbConnectionConfig("postgresql://u:p@ep-x.aws.neon.tech/db?sslmode=require&channel_binding=require", {}, (u) => {
      u.hostname = u.hostname.replace(/^(ep-[^.]+)(\.)/, "$1-pooler$2");
      u.searchParams.delete("channel_binding");
    });
    expect(c.connectionString).toBe("postgresql://u:p@ep-x-pooler.aws.neon.tech/db?sslmode=verify-full");
  });

  it("свой Postgres с DATABASE_CA — sslmode убран из строки, проверка по нашему CA", () => {
    const c = dbConnectionConfig("postgresql://u:p@1.2.3.4:5432/rb?sslmode=require", { DATABASE_CA: PEM.replace(/\n/g, "\\n") });
    expect(c.connectionString).toBe("postgresql://u:p@1.2.3.4:5432/rb");
    expect(c.ssl?.ca).toBe(PEM);
    expect(c.ssl?.rejectUnauthorized).toBe(true);
  });

  it("мусор вместо PEM — игнорируем, ведём себя как без CA", () => {
    const c = dbConnectionConfig("postgresql://u:p@h/db?sslmode=require", { DATABASE_CA: "oops" });
    expect(c.ssl).toBeUndefined();
  });

  it("внутренняя строка без sslmode (TG-бот рядом с базой) — без TLS, как задана", () => {
    expect(dbConnectionConfig("postgresql://u:p@postgres-abc:5432/rb", {}).connectionString).toBe("postgresql://u:p@postgres-abc:5432/rb");
  });
});
