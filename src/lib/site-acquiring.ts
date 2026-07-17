/**
 * Public storefront payments are fail-closed. Only the exact string `true`
 * enables both the server payment route and the checkout CTA.
 */
export function isSiteAcquiringEnabled(value = process.env.SITE_ACQUIRING_ENABLED) {
  return value === "true";
}
