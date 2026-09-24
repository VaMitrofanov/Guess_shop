import "server-only";

import { unstable_cache } from "next/cache";

/** Production uses Next's data cache; CLI diagnostics can opt out explicitly. */
export function adminCache<Result>(
  loader: () => Promise<Result>,
  keyParts: string[],
  options: { tags: string[]; revalidate: number },
) {
  return process.env.ADMIN_DISABLE_NEXT_CACHE === "1"
    ? loader
    : unstable_cache(loader, keyParts, options);
}
