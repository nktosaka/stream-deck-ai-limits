import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderName, type ModelUsage, type StandardUsageResult } from "@lenadweb/ai-limits";

// Keep this separate from Claude Code's authentication store: quota data only.
export const CLAUDE_STATUSLINE_FILE = join(homedir(), ".stream-deck-ai-limits", "claude-statusline.json");
export const STATUSLINE_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_FILE_SIZE = 8192;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const MAX_RESET_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

type Dict = Record<string, unknown>;

function record(value: unknown): Dict | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Dict : null;
}

function usageWindow(input: unknown, now: number): ModelUsage | null {
    const data = record(input);
    if (!data) return null;
    const pct = data.usedPercentage;
    const reset = data.resetsAt;
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
    if (typeof reset !== "number" || !Number.isFinite(reset)) return null;
    const resetMs = reset * 1000;
    // Do not turn an already-reset, last-known quota into a false 100% remaining.
    if (resetMs <= now || resetMs > now + MAX_RESET_HORIZON_MS) return null;
    return { usagePercent: pct, resetTime: new Date(resetMs).toISOString() };
}

/**
 * Transform an untrusted, quota-only snapshot into the same buckets as the
 * existing Claude provider. Absent windows remain absent; never invent 100%.
 */
export function parseClaudeStatusLineUsage(input: unknown, now = Date.now()):
    (StandardUsageResult & { source: "statusLine" }) | null {
    const data = record(input);
    if (!data || data.version !== 1) return null;
    const captured = data.capturedAt;
    if (typeof captured !== "number" || !Number.isFinite(captured)
        || captured > now + MAX_FUTURE_SKEW_MS || now - captured > STATUSLINE_MAX_AGE_MS) return null;
    const windows = record(data.windows);
    if (!windows) return null;

    const five = usageWindow(windows.five_hour, now);
    const seven = usageWindow(windows.seven_day, now);
    if (!five && !seven) return null;
    const perModel: Record<string, ModelUsage> = {};
    if (five) perModel["5h_quota"] = five;
    if (seven) perModel["7d_quota"] = seven;
    const mostConstrained = !five ? seven : !seven ? five
        : (five.usagePercent ?? 0) >= (seven.usagePercent ?? 0) ? five : seven;

    return {
        source: "statusLine",
        provider: ProviderName.Claude,
        overallUsagePercent: mostConstrained?.usagePercent ?? null,
        overallResetTime: mostConstrained?.resetTime ?? null,
        perModel
    };
}

/** Read-only, best-effort cache; no credential/token IO, network, or side effects. */
export async function loadClaudeStatusLineUsage(file = CLAUDE_STATUSLINE_FILE, now = Date.now()):
    Promise<(StandardUsageResult & { source: "statusLine" }) | null> {
    try {
        const info = await stat(file);
        if (!info.isFile() || info.size <= 0 || info.size > MAX_FILE_SIZE) return null;
        const json = JSON.parse(await readFile(file, "utf8"));
        return parseClaudeStatusLineUsage(json, now);
    } catch {
        return null;
    }
}
