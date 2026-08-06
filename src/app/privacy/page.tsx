import { permanentRedirect } from "next/navigation";

/**
 * Legacy privacy page.
 *
 * The old `/privacy` page described only VK ID data handling and predated the
 * ФЗ-152-compliant policy. The canonical document now lives at `/legal/policy`
 * (a strict superset: VK ID data, third-party transfer, subject rights, cookie).
 *
 * We keep this route as a permanent (308) redirect so external references that
 * still point at `/privacy` — e.g. the URL registered in the VK ID app — resolve
 * to the single source of truth instead of a stale, contradictory copy.
 */
export default function PrivacyRedirect() {
  permanentRedirect("/legal/policy");
}
