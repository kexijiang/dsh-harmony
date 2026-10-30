const origins = new Set<string>();
export function setOrigin(value: string) { origins.add(value); }
export function removeOrigin(value: string) { origins.delete(value); }
export function isApiRequestAllowed(request: Request) {
  const url = new URL(request.url);
  return origins.has(url.origin) && (!request.headers.get('origin') || request.headers.get('origin') === url.origin)
    && !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '');
}
export const hasJsonContentType = (request: Request) => /^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '');
