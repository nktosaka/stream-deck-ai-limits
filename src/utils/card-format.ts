/**
 * Display-only helpers for the card layout. The data layer keeps reporting
 * usage; only the card turns it into what is left.
 */

/** Share of the quota still available, as a whole percent in [0, 100]. */
export function remainingPercent(usagePercent: number | null | undefined): number {
    const usage = typeof usagePercent === "number" && Number.isFinite(usagePercent) ? usagePercent : 0;
    return Math.max(0, Math.min(100, Math.round(100 - usage)));
}

/** Asia/Tokyo has not observed daylight saving time since 1951, so it is a fixed UTC+9. */
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * A reset time as `MM/DD HH:mm` in Asia/Tokyo, whatever the host timezone is.
 * Numbers are Unix seconds, like everywhere else in the plugin. Returns null when
 * there is no usable time, so the caller can draw its own fallback.
 */
export function formatResetTokyo(resetTime: string | number | null | undefined): string | null {
    if (resetTime === null || resetTime === undefined || resetTime === "") return null;
    const ms = typeof resetTime === "number" ? resetTime * 1000 : new Date(resetTime).getTime();
    if (!Number.isFinite(ms)) return null;

    const tokyo = new Date(ms + TOKYO_OFFSET_MS);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(tokyo.getUTCMonth() + 1)}/${pad(tokyo.getUTCDate())} ${pad(tokyo.getUTCHours())}:${pad(tokyo.getUTCMinutes())}`;
}
