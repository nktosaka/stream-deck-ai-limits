import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_CACHE_FILE = join(homedir(), ".stream-deck-ai-limits", "claude-statusline.json");

/** Only the quota windows leave the Claude Code process. No auth or transcript data. */
export function extractQuotaSnapshot(input, now = Date.now()) {
    const windows = {};
    const rate = input && typeof input === "object" ? input.rate_limits : null;
    for (const key of ["five_hour", "seven_day"]) {
        const item = rate && typeof rate === "object" ? rate[key] : null;
        const pct = item?.used_percentage;
        const reset = item?.resets_at;
        if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
        if (typeof reset !== "number" || !Number.isFinite(reset) || reset * 1000 <= now) continue;
        if (reset * 1000 > now + 14 * 24 * 60 * 60 * 1000) continue;
        windows[key] = { usedPercentage: pct, resetsAt: reset };
    }
    if (Object.keys(windows).length === 0) return null;
    return { version: 1, capturedAt: now, windows };
}

/** Atomic replacement avoids partial JSON when two Claude Code windows update. */
export async function saveQuotaSnapshot(input, file = DEFAULT_CACHE_FILE, now = Date.now()) {
    const snapshot = extractQuotaSnapshot(input, now);
    if (!snapshot) return false;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + "." + process.pid + "." + randomUUID() + ".tmp";
    try {
        await writeFile(temporary, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 });
        // On Windows another Claude statusLine process or antivirus may briefly
        // hold the destination with a non-sharing handle. Retry only transient
        // Windows file-access failures; never remove the destination or write
        // partially over it. A failed update leaves the last good snapshot.
        for (let attempt = 0; ; attempt++) {
            try {
                await rename(temporary, file);
                break;
            } catch (err) {
                const transient = ["EPERM", "EACCES", "EBUSY"].includes(err?.code);
                if (!transient || attempt >= 9) throw err;
                await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(20 * (attempt + 1), 120)));
            }
        }
    } finally {
        await unlink(temporary).catch(() => {});
    }
    return true;
}

export async function main() {
    let input = "";
    try {
        for await (const chunk of process.stdin) {
            input += chunk;
            if (input.length > 131072) throw new Error("invalid statusLine input");
        }
        const data = JSON.parse(input);
        // Writing a snapshot must never break Claude Code's own status line.
        await saveQuotaSnapshot(data).catch(() => {});
        const model = typeof data.model?.display_name === "string" ? data.model.display_name : "Claude";
        const windows = extractQuotaSnapshot(data)?.windows ?? {};
        const segments = [model];
        if (windows.five_hour) segments.push("5h remaining " + Math.round(100 - windows.five_hour.usedPercentage) + "%");
        if (windows.seven_day) segments.push("7d remaining " + Math.round(100 - windows.seven_day.usedPercentage) + "%");
        process.stdout.write(segments.join(" | ") + "\n");
    } catch {
        process.stdout.write("Claude\n");
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
