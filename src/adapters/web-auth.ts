import { randomUUID, timingSafeEqual } from 'node:crypto';
export const PI_DESKTOP_TOKEN_HEADER = 'x-pi-desktop-token';
// Host-only capability: the HTTP adapter inserts this after same-origin validation.
export const internalToken = randomUUID();
export function isValidDesktopToken(value: string | null) {
  return Boolean(value && value.length === internalToken.length && timingSafeEqual(Buffer.from(value), Buffer.from(internalToken)));
}
