/**
 * VK ID is hidden by default while the production provider is under repair.
 * This public build-time flag must be enabled only after a live login check.
 */
export function isVkAuthEnabled(value = process.env.NEXT_PUBLIC_VK_AUTH_ENABLED) {
  return value === "true";
}

export const VK_AUTH_ENABLED = isVkAuthEnabled();
