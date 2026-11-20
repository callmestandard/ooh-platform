// Sends a browser error to our own log (/api/client-error → app_errors).
// At most 5 per page load; common network blips and browser noise are skipped.

const NOISE = [/ResizeObserver loop/i, /^Script error\.?$/i, /Failed to fetch/i, /Load failed/i, /NetworkError/i, /AbortError/i, /The user aborted/i, /cancell?ed/i];
let sent = 0;
const seen = new Set<string>();

export function reportClientError(message: string, detail: Record<string, string | number | boolean | undefined> = {}, digest?: string) {
  try {
    if (typeof window === 'undefined' || !message || NOISE.some(r => r.test(message))) return;
    const key = message.slice(0, 120);
    if (seen.has(key) || sent >= 5) return;
    seen.add(key); sent++;
    const body = JSON.stringify({ message: message.slice(0, 500), path: window.location.pathname, digest, detail: { ...detail, ua: navigator.userAgent.slice(0, 160) } });
    const blob = new Blob([body], { type: 'application/json' });
    if (!navigator.sendBeacon?.('/api/client-error', blob)) {
      void fetch('/api/client-error', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* never let error reporting cause an error */ }
}
