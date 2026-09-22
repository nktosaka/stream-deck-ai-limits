import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgressBars } from "../src/actions/progress-bars";
import { CodexProgressBars } from "../src/actions/codex-progress-bars";

/** Shapes as @lenadweb/ai-limits returns them; only the fields the tiles read. */
const claudeResult: any = {
    perModel: {
        five_hour: { usagePercent: 0, resetTime: "2026-09-18T13:59:00Z" },
        seven_day: { usagePercent: 45, resetTime: "2026-09-23T21:59:00Z" }
    }
};

const codexResult: any = {
    perModel: {
        primary_window: { usagePercent: 10, resetTime: "2026-09-18T14:00:00Z", windowSeconds: 18000 },
        secondary_window: { usagePercent: 32, resetTime: "2026-09-24T09:17:00Z", windowSeconds: 604800 }
    }
};

/** Plans without a 5-hour window report the weekly one as `primary_window` (issue #6). */
const codexWeeklyOnly: any = {
    perModel: { primary_window: { usagePercent: 32, resetTime: "2026-09-24T09:17:00Z", windowSeconds: 604800 } }
};

const ev = (settings: Record<string, unknown>) => ({ payload: { settings } });
const display = (action: any, settings: Record<string, unknown>, result: any) => action.getDisplayData(ev(settings), result);

test("claude: tiles without a layout keep the two-bar view", () => {
    const data = display(new ProgressBars(), {}, claudeResult);
    assert.equal(data.card, undefined);
    assert.equal(data.ring, undefined);
    assert.deepEqual(data.slots.map((s: any) => [s.label, s.percent]), [["Session", 0], ["Week", 45]]);
});

test("claude: ring is unchanged and shows usage", () => {
    const data = display(new ProgressBars(), { layout: "ring", metric: "weekly" }, claudeResult);
    assert.equal(data.ring.label, "Week");
    assert.equal(data.ring.percent, 45);
});

test("claude: card defaults to the session, like the ring", () => {
    const data = display(new ProgressBars(), { layout: "card" }, claudeResult);
    assert.equal(data.card.cardLabel, "5時間・残り");
    assert.equal(data.card.percent, 0);
    assert.equal(data.card.resetAt, "2026-09-18T13:59:00Z");
});

test("claude: weekly card keeps usage in the slot; remaining is the renderer's job", () => {
    const data = display(new ProgressBars(), { layout: "card", metric: "weekly" }, claudeResult);
    assert.equal(data.card.cardLabel, "週間・残り");
    assert.equal(data.card.percent, 45);
    assert.equal(data.card.resetAt, "2026-09-23T21:59:00Z");
});

test("claude: a card for a window the account lacks is muted", () => {
    const data = display(new ProgressBars(), { layout: "card", metric: "weeklySonnet" }, claudeResult);
    assert.equal(data.card.muted, true);
    assert.equal(data.card.cardLabel, "Sonnet週間・残り");
});

test("codex: tiles without a layout keep the two-bar view with the legacy bottom slot", () => {
    const data = display(new CodexProgressBars(), { secondaryMetric: "credits" }, codexResult);
    assert.equal(data.card, undefined);
    assert.deepEqual(data.slots.map((s: any) => s.label), ["Week", "Credits balance"]);
    assert.equal(data.slots[0].percent, 32);
});

test("codex: ring is unchanged and shows usage", () => {
    const data = display(new CodexProgressBars(), { layout: "ring" }, codexResult);
    assert.equal(data.ring.label, "Week");
    assert.equal(data.ring.percent, 32);
});

test("codex: card defaults to the weekly window", () => {
    const data = display(new CodexProgressBars(), { layout: "card" }, codexResult);
    assert.equal(data.card.cardLabel, "週間・残り");
    assert.equal(data.card.percent, 32);
    assert.equal(data.card.resetAt, "2026-09-24T09:17:00Z");
});

test("codex: weekly card still works when the weekly window arrives as primary", () => {
    const data = display(new CodexProgressBars(), { layout: "card", metric: "weekly" }, codexWeeklyOnly);
    assert.equal(data.card.cardLabel, "週間・残り");
    assert.equal(data.card.percent, 32);
});

test("codex: session card names the window from its reported length", () => {
    const data = display(new CodexProgressBars(), { layout: "card", metric: "session" }, codexResult);
    assert.equal(data.card.cardLabel, "5時間・残り");
});

test("draw: a card tile sets a remaining card image", async () => {
    const action: any = new CodexProgressBars();
    const images: string[] = [];
    const fake = { id: "k1", setImage: async (image: string) => { images.push(image); } };
    await action.draw({ action: fake, payload: { settings: { layout: "card" }, controller: "Keypad" } }, codexResult);
    const svg = Buffer.from(images[0].split(",")[1], "base64").toString("utf8");
    assert.match(svg, /週間・残り/);
    assert.match(svg, />68</);
    assert.match(svg, /09\/24 18:17/);
});

test("refresh: the interval is five minutes", () => {
    assert.equal((new ProgressBars() as any).monitoringIntervalMs, 300000);
    assert.equal((new CodexProgressBars() as any).monitoringIntervalMs, 300000);
});

test("refresh: tiles of one provider share a single fetch", async () => {
    const action: any = new ProgressBars();
    let fetches = 0;
    action.fetchProviderUsage = async () => { fetches++; return claudeResult; };
    action.persistScopesToSettings = async () => {};
    const tile = (id: string, settings: object) => ({
        action: { id, setImage: async () => {}, setSettings: async () => {} },
        controller: "Keypad",
        settings
    });
    action.instances.set("a", tile("a", { layout: "card", metric: "weekly" }));
    action.instances.set("b", tile("b", { layout: "card", metric: "session" }));
    action.instances.set("c", tile("c", {}));
    await action.refreshAll();
    assert.equal(fetches, 1);
});
