import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractQuotaSnapshot, saveQuotaSnapshot } from "../scripts/claude-statusline-bridge.mjs";

const NOW = Date.UTC(2026, 9, 24, 10, 0, 0);
const sample = (five = 23.5, seven = 41.2) => ({
    model: { display_name: "Opus" },
    rate_limits: {
        five_hour: { used_percentage: five, resets_at: (NOW + 60 * 60 * 1000) / 1000 },
        seven_day: { used_percentage: seven, resets_at: (NOW + 5 * 24 * 60 * 60 * 1000) / 1000 }
    },
    // Must never appear in the quota-only cache:
    session_id: "private-session",
    transcript_path: "private-transcript",
    authorization: "Bearer secret-token",
    prompt: "private conversation"
});

test("bridge: stores only statusLine quota fields (not auth, session or transcript)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-statusline-"));
    try {
        const file = join(dir, "usage.json");
        assert.equal(await saveQuotaSnapshot(sample(), file, NOW), true);
        const raw = await readFile(file, "utf8");
        const value = JSON.parse(raw);
        assert.deepEqual(Object.keys(value).sort(), ["capturedAt", "version", "windows"]);
        assert.deepEqual(value.windows.five_hour, {
            usedPercentage: 23.5, resetsAt: (NOW + 60 * 60 * 1000) / 1000
        });
        assert.doesNotMatch(raw, /secret-token|private-session|private-transcript|private conversation/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("bridge: no overwrite when Claude has no quota fields before its first response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-statusline-"));
    try {
        const file = join(dir, "usage.json");
        await saveQuotaSnapshot(sample(), file, NOW);
        const before = await readFile(file, "utf8");
        assert.equal(await saveQuotaSnapshot({ model: { display_name: "Opus" } }, file, NOW + 1000), false);
        assert.equal(await readFile(file, "utf8"), before);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("bridge: invalid percentages, stale windows and nonnumeric values are rejected", () => {
    assert.equal(extractQuotaSnapshot(sample(NaN, -5), NOW), null);
    const data = sample();
    data.rate_limits.five_hour.resets_at = (NOW - 1) / 1000;
    const output = extractQuotaSnapshot(data, NOW);
    assert.deepEqual(Object.keys(output?.windows ?? {}), ["seven_day"]);
});

test("bridge: simultaneous writes never leave partially written JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-statusline-"));
    try {
        const file = join(dir, "usage.json");
        await Promise.all(Array.from({ length: 10 }, (_, i) =>
            saveQuotaSnapshot(sample(10 + i, 50 + i), file, NOW + i)
        ));
        const json = JSON.parse(await readFile(file, "utf8"));
        assert.equal(json.version, 1);
        assert.ok(json.windows.five_hour.usedPercentage >= 10);
        assert.ok(json.windows.five_hour.usedPercentage <= 19);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
