/**
 * VK ID stays fail-closed unless production explicitly enables it.
 * This is a public build-time flag, not a security boundary.
 */
export function isVkAuthEnabled(value = process.env.NEXT_PUBLIC_VK_AUTH_ENABLED) {
  return value === "true";
}

export const VK_AUTH_ENABLED = isVkAuthEnabled();
