import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderName, ClaudeProvider } from "@lenadweb/ai-limits";
import { LimitsManager } from "../src/services/limits-manager";
import {
    loadClaudeStatusLineUsage,
    parseClaudeStatusLineUsage,
    STATUSLINE_MAX_AGE_MS
} from "../src/services/claude-statusline-cache";

const NOW = Date.UTC(2026, 9, 24, 10, 0);
const snapshot = (capturedAt = NOW) => ({
    version: 1, capturedAt,
    windows: {
        five_hour: { usedPercentage: 23.5, resetsAt: (NOW + 3600000) / 1000 },
        seven_day: { usedPercentage: 41.2, resetsAt: (NOW + 5 * 86400000) / 1000 }
    }
});

test("statusLine: converts official fields to existing Claude buckets", () => {
    const usage = parseClaudeStatusLineUsage(snapshot(), NOW);
    assert.equal(usage?.source, "statusLine");
    assert.equal(usage?.provider, ProviderName.Claude);
    assert.equal(usage?.perModel?.["5h_quota"].usagePercent, 23.5);
    assert.equal(usage?.perModel?.["7d_quota"].usagePercent, 41.2);
    assert.equal(usage?.overallUsagePercent, 41.2);
    assert.equal(usage?.perModel?.["5h_quota"].resetTime, new Date(NOW + 3600000).toISOString());
});

test("statusLine: missing one window does not invent 100% remaining", () => {
    const data = snapshot();
    delete (data.windows as any).seven_day;
    const usage = parseClaudeStatusLineUsage(data, NOW);
    assert.equal(usage?.perModel?.["5h_quota"].usagePercent, 23.5);
    assert.equal(usage?.perModel?.["7d_quota"], undefined);
});

test("statusLine: rejects out-of-date, future-dated, reset or malformed snapshots", () => {
    assert.equal(parseClaudeStatusLineUsage(snapshot(NOW - STATUSLINE_MAX_AGE_MS - 1), NOW), null);
    assert.equal(parseClaudeStatusLineUsage(snapshot(NOW + 31000), NOW), null);
    assert.equal(parseClaudeStatusLineUsage({ ...snapshot(), version: 2 }, NOW), null);
    assert.equal(parseClaudeStatusLineUsage({ ...snapshot(), windows: {
        five_hour: { usedPercentage: 100, resetsAt: (NOW - 1000) / 1000 }
    } }, NOW), null);
    assert.equal(parseClaudeStatusLineUsage({ ...snapshot(), windows: {
        five_hour: { usedPercentage: -1, resetsAt: (NOW + 3600000) / 1000 }
    } }, NOW), null);
});

test("statusLine: reads a quota-only file and tolerates corruption/missing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "statusline-reader-"));
    const file = join(dir, "snapshot.json");
    try {
        await writeFile(file, JSON.stringify(snapshot()));
        assert.equal((await loadClaudeStatusLineUsage(file, NOW))?.perModel?.["7d_quota"].usagePercent, 41.2);
        await writeFile(file, "{corrupt");
        assert.equal(await loadClaudeStatusLineUsage(file, NOW), null);
        await writeFile(file, "a".repeat(9000));
        assert.equal(await loadClaudeStatusLineUsage(file, NOW), null);
        assert.equal(await loadClaudeStatusLineUsage(file + ".missing", NOW), null);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("credential ownership: SDK OAuth auto-refresh is disabled for Claude only", () => {
    const client = LimitsManager.getInstance().getClient();
    const claude = client.getProvider<ClaudeProvider>(ProviderName.Claude);
    // @lenadweb/ai-limits 1.2.0 stores the constructor option on the provider.
    assert.equal((claude as any).autoRefresh, false);
});
