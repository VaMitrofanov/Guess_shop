import TelegramLoginCallback from "@/components/auth/TelegramLoginCallback";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

export default async function TelegramCallbackPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode = scalar(params.mode) === "link" ? "link" : "login";
  const payload = {
    id: scalar(params.id),
    first_name: scalar(params.first_name),
    ...(scalar(params.last_name) ? { last_name: scalar(params.last_name) } : {}),
    ...(scalar(params.username) ? { username: scalar(params.username) } : {}),
    auth_date: scalar(params.auth_date),
    hash: scalar(params.hash),
  };

  return (
    <main className="grid min-h-screen min-h-[100dvh] place-items-center bg-[var(--rb-bg)] p-5">
      <TelegramLoginCallback mode={mode} state={scalar(params.state)} payload={payload} />
    </main>
  );
}
