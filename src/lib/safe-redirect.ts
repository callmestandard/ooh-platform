/**
 * Where to send someone after login or sign-up, from a `?redirect=` value.
 * Only same-site paths are accepted ("/boards/123?request=1"); anything else
 * (another site, "//evil.com", "javascript:") returns null so a link can't
 * bounce users off the platform after they sign in.
 */
export function safeRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null;
  if (/[\u0000-\u001f]/.test(v)) return null;
  return v;
}
