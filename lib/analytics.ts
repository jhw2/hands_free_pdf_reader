// Public GA4 destination linked to the supplied GTM-TG86F7CB Google tag.
export const gaMeasurementId = "G-GSVS893CJ5";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackInteraction(name: string) {
  if (typeof window === "undefined" || !/^(score|reader)_[a-z_]{1,32}$/.test(name)) return;
  try {
    // Event names are fixed in code. Never include file names, searches, URLs, or field values.
    window.gtag?.("event", name, { send_to: gaMeasurementId });
  } catch { /* Analytics must not interrupt reading or playback. */ }
}

export function recordInteraction(event: Event) {
  if (!(event.target instanceof Element) || !["click", "change"].includes(event.type)) return;
  const attribute = `data-analytics-${event.type}`;
  const control = event.target.closest(`[${attribute}]`);
  if (!control || control.matches(":disabled") || control.closest('[aria-disabled="true"]')) return;
  if (control instanceof HTMLInputElement && control.type === "file" && !control.files?.length) return;
  trackInteraction(control.getAttribute(attribute) ?? "");
}
