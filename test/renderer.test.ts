import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProgressBarRenderer, Slot } from "../src/ui/progress-bar-renderer";
import { RING_BAR_CASES } from "./regression-cases";

const renderer = new ProgressBarRenderer();

const CODEX = "#38BDF8";
const CLAUDE = "#EB8456";
const WARN = "#F5B83D";
const DANGER = "#F0524D";

const codexWeekly: Slot = {
    kind: "gauge", label: "Week", cardLabel: "週間・残り", percent: 32, caption: "1d 23h", resetAt: "2026-09-24T09:17:00Z"
};
const claudeWeekly: Slot = {
    kind: "gauge", label: "Week", cardLabel: "週間・残り", percent: 45, caption: "1d 11h", resetAt: "2026-09-23T21:59:00Z"
};
const claudeSession: Slot = {
    kind: "gauge", label: "Session", cardLabel: "5時間・残り", percent: 0, caption: "3h", resetAt: "2026-09-18T13:59:00Z"
};

const card = (slot: Slot, theme: "codex" | "claude" = "codex", w = 144, h = 144) => renderer.renderRemainingCard(slot, theme, w, h);
const usage = (percent: number, theme: "codex" | "claude" = "codex") => card({ ...codexWeekly, percent }, theme);

/** Every text run of an SVG, with its tspans flattened. */
function texts(svg: string): string[] {
    return [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
}

function valueSizes(svg: string): number[] {
    return [...svg.matchAll(/<tspan font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
}

function rectWidth(svg: string, cls: string): number | null {
    const m = svg.match(new RegExp(`<rect class="${cls}"[^>]*width="([\\d.]+)"`));
    return m ? Number(m[1]) : null;
}

function rectFill(svg: string, cls: string): string | null {
    return svg.match(new RegExp(`<rect class="${cls}"[^>]*fill="(#[0-9A-F]+)"`))?.[1] ?? null;
}

function percentFill(svg: string): string {
    return svg.match(/<text[^>]*fill="(#[0-9A-F]+)" text-anchor="start"><tspan/)![1];
}

function borderStroke(svg: string): string {
    return svg.match(/<rect x="[\d.]+" y="[\d.]+"[^>]*fill="none" stroke="(#[0-9A-F]+)"/)![1];
}

/**
 * Horizontal extent of every text run: generic runs by the renderer's own
 * estimate, the percent block by the Segoe UI Bold advances it is centred with.
 */
function extents(svg: string): { text: string; left: number; right: number }[] {
    const r = renderer as any;
    const font = (ProgressBarRenderer as any).CARD_SANS;
    return [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+"([^>]*)>(.*?)<\/text>/g)].map(([, xs, attrs, body]) => {
        const x = Number(xs);
        const tspans = [...body.matchAll(/<tspan font-size="([\d.]+)"[^>]*>(.*?)<\/tspan>/g)];
        if (tspans.length) {
            const [[, digitSize, digits], [, unitSize]] = tspans;
            const w = digits.length * 0.574 * Number(digitSize) + 1 + 0.879 * Number(unitSize);
            return { text: digits + "%", left: x, right: x + w };
        }
        const size = Number(attrs.match(/font-size="([\d.]+)"/)![1]);
        const weight = Number(attrs.match(/font-weight="(\d+)"/)![1]);
        const tracking = Number(attrs.match(/letter-spacing="([\d.]+)"/)?.[1] ?? 0);
        const text = body.replace(/&amp;/g, "&");
        const w = r.measure(text, size, font, weight) + Math.max(0, [...text].length - 1) * tracking;
        const anchor = attrs.match(/text-anchor="(\w+)"/)![1];
        const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
        return { text, left, right: left + w };
    });
}

test("card: Codex weekly shows remaining, not usage, in the Codex accent", () => {
    const svg = card(codexWeekly);
    assert.deepEqual(texts(svg), ["CODEX", "週間・残り", "68%", "リセット（日本時間）", "09/24 18:17"]);
    assert.equal(borderStroke(svg), CODEX);
    assert.equal(percentFill(svg), CODEX);
    assert.doesNotMatch(svg, /32%/);
});

test("card: Claude weekly", () => {
    const svg = card(claudeWeekly, "claude");
    assert.deepEqual(texts(svg), ["CLAUDE", "週間・残り", "55%", "リセット（日本時間）", "09/24 06:59"]);
    assert.equal(borderStroke(svg), CLAUDE);
    assert.equal(percentFill(svg), CLAUDE);
});

test("card: Claude 5-hour session", () => {
    const svg = card(claudeSession, "claude");
    assert.deepEqual(texts(svg), ["CLAUDE", "5時間・残り", "100%", "リセット（日本時間）", "09/18 22:59"]);
});

test("card: every line is centred on the key's axis", () => {
    for (const svg of [card(codexWeekly), card(claudeSession, "claude"), usage(95), card({ ...codexWeekly, resetAt: null })]) {
        for (const { text, left, right } of extents(svg)) {
            // Letter spacing trails the provider name by one step, which the renderer offsets.
            const centre = (left + right) / 2 - (/^[A-Z]+$/.test(text) ? 0.8 : 0);
            assert.ok(Math.abs(centre - 72) < 0.05, `${text} is centred at ${centre}`);
        }
    }
});

test("card: 100% keeps the full value size inside the key", () => {
    assert.deepEqual(valueSizes(card(claudeSession, "claude")), [46, 24]);
});

test("card: every line fits between the border's inner margins", () => {
    for (const svg of [card(codexWeekly), card(claudeSession, "claude"), usage(95), usage(100)]) {
        for (const { text, left, right } of extents(svg)) {
            assert.ok(left >= 14 && right <= 130, `${text} spans ${left}..${right}`);
        }
    }
});

test("card: the date keeps clear of the bottom border", () => {
    const svg = card(claudeSession, "claude");
    const y = Number(svg.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*font-size="15"/)![1]);
    // The inner edge of the border sits at 144 - 4 - 0.625.
    assert.ok(144 - 4.625 - y >= 8, `date baseline at ${y}`);
});

test("indicator: remaining 0% is an empty track", () => {
    const svg = usage(100);
    assert.equal(rectWidth(svg, "card-track"), 104);
    assert.equal(rectWidth(svg, "card-fill"), null);
});

test("indicator: remaining 50% fills half the track", () => {
    assert.equal(rectWidth(usage(50), "card-fill"), 52);
});

test("indicator: remaining 68% fills 68% of the track", () => {
    assert.equal(rectWidth(usage(32), "card-fill"), 70.72);
});

test("indicator: remaining 100% fills the whole track", () => {
    assert.equal(rectWidth(usage(0), "card-fill"), 104);
});

test("indicator: clamps with the remaining value", () => {
    assert.equal(rectWidth(usage(-20), "card-fill"), 104);
    assert.equal(rectWidth(usage(130), "card-fill"), null);
    assert.equal(rectWidth(usage(99.6), "card-fill"), null);
});

test("indicator: a 1% sliver keeps its round caps", () => {
    const svg = usage(99);
    assert.equal(rectWidth(svg, "card-fill"), 5);
    assert.match(svg, /class="card-fill"[^>]*rx="2.5"/);
});

test("indicator: track is centred under the value", () => {
    const svg = usage(50);
    const x = Number(svg.match(/class="card-track" x="([\d.]+)"/)![1]);
    assert.equal(x + 104 / 2, 72);
});

test("status: number and indicator share the provider accent down to 30% left", () => {
    for (const [theme, accent] of [["codex", CODEX], ["claude", CLAUDE]] as const) {
        const svg = usage(70, theme);
        assert.equal(percentFill(svg), accent);
        assert.equal(rectFill(svg, "card-fill"), accent);
    }
});

test("status: below 30% left both turn amber", () => {
    for (const u of [71, 88]) {
        const svg = usage(u, "claude");
        assert.equal(percentFill(svg), WARN, `usage ${u}`);
        assert.equal(rectFill(svg, "card-fill"), WARN, `usage ${u}`);
    }
});

test("status: below 12% left both turn red", () => {
    for (const u of [89, 95, 100]) {
        const svg = usage(u, "claude");
        assert.equal(percentFill(svg), DANGER, `usage ${u}`);
        if (u < 100) assert.equal(rectFill(svg, "card-fill"), DANGER, `usage ${u}`);
    }
});

test("status: the border keeps the provider accent at any level", () => {
    assert.equal(borderStroke(usage(95, "claude")), CLAUDE);
    assert.equal(borderStroke(usage(80, "codex")), CODEX);
});

test("status: the warning colours differ from both accents", () => {
    for (const color of [WARN, DANGER]) {
        assert.notEqual(color, CODEX);
        assert.notEqual(color, CLAUDE);
    }
});

test("card: missing reset time draws a dash, not a broken date", () => {
    const svg = card({ ...codexWeekly, resetAt: undefined });
    const t = texts(svg);
    assert.equal(t[3], "リセット（日本時間）");
    assert.equal(t[4], "—");
    assert.doesNotMatch(svg, /NaN|undefined|Invalid/);
});

test("card: a metric with no data is muted, has no indicator, and never claims 100% left", () => {
    const svg = card({ kind: "stat", label: "Week", cardLabel: "週間・残り", valueText: "—", caption: "no data", muted: true }, "claude");
    assert.deepEqual(texts(svg), ["CLAUDE", "週間・残り", "—", "リセット（日本時間）", "—"]);
    assert.equal(rectWidth(svg, "card-track"), null);
});

test("card: a balance has no reset row and no indicator", () => {
    const svg = card({ kind: "stat", label: "Credits balance", shortLabel: "Credits", valueText: "$12.50" });
    assert.deepEqual(texts(svg), ["CODEX", "Credits", "$12.50"]);
    assert.equal(rectWidth(svg, "card-track"), null);
});

test("card: provider name can be hidden", () => {
    const svg = renderer.renderRemainingCard(codexWeekly, "codex", 144, 144, { showName: false });
    assert.ok(!texts(svg).includes("CODEX"));
});

test("card: long scoped names shrink or truncate instead of overflowing", () => {
    const svg = card({ ...claudeWeekly, cardLabel: "claude-fable-5-1-extended週間・残り" }, "claude");
    const quota = texts(svg)[1];
    assert.ok(quota.endsWith("…"), quota);
});

test("dial: same content, indicator under the value, reset time in its own column", () => {
    const svg = card(claudeSession, "claude", 200, 100);
    assert.deepEqual(texts(svg), ["CLAUDE", "5時間・残り", "100%", "リセット（JST）", "09/18 22:59"]);
    assert.equal(rectWidth(svg, "card-fill"), 84);
    const [provider, quota, value, label, date] = extents(svg);
    for (const e of [provider, quota, value]) assert.ok(e.right <= 116, `${e.text} ends at ${e.right}`);
    for (const e of [label, date]) assert.ok(e.left >= 116 && e.right <= 190, `${e.text} spans ${e.left}..${e.right}`);
    assert.ok(Math.abs((value.left + value.right) / 2 - 62) < 0.05);
    assert.ok(Math.abs((date.left + date.right) / 2 - 152) < 0.05);
});

for (const c of RING_BAR_CASES) {
    test(`regression: ${c.name} is byte-identical to upstream`, () => {
        const svg = c.kind === "ring"
            ? renderer.renderRing(c.slots[0], c.theme, c.w, c.h, c.opts)
            : renderer.renderSlots(c.slots, c.theme, c.w, c.h, c.opts);
        const golden = readFileSync(`test/fixtures/${c.name}.svg`, "utf8").trim();
        assert.equal(svg, golden);
    });
}

test("regression: ring and bars still show usage, not remaining", () => {
    const ring = renderer.renderRing({ kind: "gauge", label: "Week", percent: 45 }, "claude", 144, 144);
    const bars = renderer.renderSlots([{ kind: "gauge", label: "Week", percent: 45 }], "claude", 144, 144);
    assert.ok(texts(ring).includes("45%"));
    assert.ok(texts(bars).includes("45%"));
    assert.ok(!texts(ring).includes("55%"));
});
