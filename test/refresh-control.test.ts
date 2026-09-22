import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ProgressBars } from "../src/actions/progress-bars";
import { CodexProgressBars } from "../src/actions/codex-progress-bars";
import { MIN_FETCH_GAP_MS } from "../src/actions/base-monitoring-action";

const claudeResult: any = {
    perModel: {
        five_hour: { usagePercent: 0, resetTime: "2026-09-18T13:59:00Z" },
        seven_day: { usagePercent: 45, resetTime: "2026-09-23T21:59:00Z" }
    }
};
const codexResult: any = {
    perModel: { secondary_window: { usagePercent: 32, resetTime: "2026-09-24T09:17:00Z", windowSeconds: 604800 } }
};

/** Lets pending promise callbacks run; setImmediate is left unmocked on purpose. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** An action whose fetches are counted and answered by `respond`, with tiles that record their images. */
function setup<A extends ProgressBars | CodexProgressBars>(action: A, respond: () => Promise<any>, tiles: Record<string, object>) {
    const a: any = action;
    const calls = { fetch: 0, images: {} as Record<string, number>, sentToPI: 0 };
    a.fetchProviderUsage = () => { calls.fetch++; return respond(); };
    for (const [id, settings] of Object.entries(tiles)) {
        calls.images[id] = 0;
        a.instances.set(id, {
            action: {
                id,
                setImage: async () => { calls.images[id]++; },
                setSettings: async () => {},
                sendToPropertyInspector: async () => { calls.sentToPI++; }
            },
            controller: "Keypad",
            settings
        });
    }
    const press = (id: string) => a.onKeyDown(a.asEvent(a.instances.get(id)));
    return { a, calls, press };
}

function withClock(fn: () => Promise<void>) {
    return async () => {
        mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
        try {
            await fn();
        } finally {
            mock.timers.reset();
        }
    };
}

const claudeTiles = { weekly: { layout: "card", metric: "weekly" }, session: { layout: "card", metric: "session" } };

test("gap: the first press fetches once", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    assert.equal(calls.fetch, 1);
}));

test("gap: rapid presses inside 30s do not fetch again, and keep the tile drawn", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    const drawn = calls.images.weekly;
    for (let i = 0; i < 5; i++) {
        mock.timers.tick(1000);
        await press("weekly");
    }
    assert.equal(calls.fetch, 1);
    assert.ok(calls.images.weekly > drawn, "a turned-away press still redraws the cached data");
}));

test("gap: 29999ms is too soon, 30000ms is allowed", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    mock.timers.tick(MIN_FETCH_GAP_MS - 1);
    await press("weekly");
    assert.equal(calls.fetch, 1);
    mock.timers.tick(1);
    await press("weekly");
    assert.equal(calls.fetch, 2);
}));

test("gap: a manual press after 30s fetches even though the data is under 5 minutes old", withClock(async () => {
    const { a, calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    mock.timers.tick(31_000);
    assert.equal(a.isStale(a.asEvent(a.instances.get("weekly"))), false);
    await press("weekly");
    assert.equal(calls.fetch, 2);
}));

test("share: Claude weekly and 5h pressed alternately share one fetch and both redraw", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    mock.timers.tick(5000);
    await press("session");
    mock.timers.tick(5000);
    await press("weekly");
    assert.equal(calls.fetch, 1);
    assert.ok(calls.images.weekly >= 1 && calls.images.session >= 1);
}));

test("share: one fetch redraws every Claude tile with its own metric", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    assert.equal(calls.images.weekly, 1);
    assert.equal(calls.images.session, 1);
}));

test("share: Claude's gap does not block Codex", withClock(async () => {
    const claude = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    const codex = setup(new CodexProgressBars(), async () => codexResult, { weekly: { layout: "card" } });
    await claude.press("weekly");
    await codex.press("weekly");
    mock.timers.tick(1000);
    await claude.press("session");
    assert.equal(claude.calls.fetch, 1);
    assert.equal(codex.calls.fetch, 1);
}));

test("inflight: a fetch outlasting 30s is shared, not doubled", withClock(async () => {
    const pending = deferred<any>();
    const { calls, press } = setup(new ProgressBars(), () => pending.promise, claudeTiles);
    const first = press("weekly");
    await flush();
    mock.timers.tick(45_000);
    const second = press("session");
    await flush();
    assert.equal(calls.fetch, 1);
    pending.resolve(claudeResult);
    await Promise.all([first, second]);
    assert.equal(calls.fetch, 1);
    assert.equal(calls.images.weekly, 1);
    assert.equal(calls.images.session, 1);
}));

test("inflight: the timer and a key press landing together fetch once", withClock(async () => {
    const pending = deferred<any>();
    const { a, calls, press } = setup(new ProgressBars(), () => pending.promise, claudeTiles);
    a.isMonitoring = true;
    a.startMonitoring();
    mock.timers.tick(300_000);
    await flush();
    assert.equal(calls.fetch, 1);
    const manual = press("weekly");
    await flush();
    assert.equal(calls.fetch, 1);
    pending.resolve(claudeResult);
    await manual;
    a.stopMonitoring();
}));

test("inflight: the in-flight state clears after a failure", withClock(async () => {
    const { a, press } = setup(new ProgressBars(), async () => { throw new Error("offline"); }, claudeTiles);
    await press("weekly");
    assert.equal(a.inflight.size, 0);
}));

test("failure: a thrown fetch still holds the gap, then may retry", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => { throw new Error("offline"); }, claudeTiles);
    await press("weekly");
    for (let i = 0; i < 4; i++) {
        mock.timers.tick(5000);
        await press("weekly");
    }
    assert.equal(calls.fetch, 1);
    mock.timers.tick(MIN_FETCH_GAP_MS);
    await press("weekly");
    assert.equal(calls.fetch, 2);
}));

test("failure: an error result holds the gap too", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => ({ error: { message: "Rate Limit", code: 429 } }), claudeTiles);
    await press("weekly");
    mock.timers.tick(10_000);
    await press("session");
    assert.equal(calls.fetch, 1);
}));

test("no queue: a turned-away press is never run later", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    mock.timers.tick(10_000);
    await press("weekly");
    mock.timers.tick(600_000);
    await flush();
    assert.equal(calls.fetch, 1);
}));

test("no queue: repeated presses do not push the next allowed fetch back", withClock(async () => {
    const { calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    for (let t = 0; t < 29; t++) {
        mock.timers.tick(1000);
        await press("weekly");
    }
    mock.timers.tick(1000);
    await press("weekly");
    assert.equal(calls.fetch, 2);
}));

test("cache: redrawing cached data keeps the data's fetch time", withClock(async () => {
    const { a, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    const fetchedAt = a.usage.get("").fetchedAt;
    mock.timers.tick(10_000);
    await press("weekly");
    assert.equal(a.usage.get("").fetchedAt, fetchedAt);
    assert.equal(a.attemptStartedAt.get(""), fetchedAt);
}));

test("paths: the scope picker cannot bypass the gap", withClock(async () => {
    const { a, calls, press } = setup(new ProgressBars(), async () => { throw new Error("offline"); }, claudeTiles);
    await press("weekly");
    mock.timers.tick(5000);
    const tile = a.instances.get("weekly");
    await a.onSendToPlugin({ action: tile.action, payload: { event: "getScopes" } });
    assert.equal(calls.fetch, 1);
    assert.equal(calls.sentToPI, 1);
}));

test("paths: the scope picker waits for a running fetch instead of starting one", withClock(async () => {
    const pending = deferred<any>();
    const { a, calls, press } = setup(new ProgressBars(), () => pending.promise, claudeTiles);
    const first = press("weekly");
    await flush();
    const tile = a.instances.get("session");
    const picker = a.onSendToPlugin({ action: tile.action, payload: { event: "getScopes" } });
    await flush();
    assert.equal(calls.sentToPI, 0);
    pending.resolve(claudeResult);
    await Promise.all([first, picker]);
    assert.equal(calls.fetch, 1);
    assert.equal(calls.sentToPI, 1);
}));

test("paths: a tile appearing during a fetch or inside the gap does not fetch", withClock(async () => {
    const { a, calls, press } = setup(new ProgressBars(), async () => { throw new Error("offline"); }, claudeTiles);
    await press("weekly");
    mock.timers.tick(5000);
    const tile = a.instances.get("session");
    await a.onWillAppear({ action: tile.action, payload: { settings: tile.settings, controller: "Keypad" } });
    await flush();
    assert.equal(calls.fetch, 1);
    a.stopMonitoring();
}));

test("timer: the five-minute timer fetches each interval and presses never re-create it", withClock(async () => {
    const { a, calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    a.isMonitoring = true;
    a.startMonitoring();
    const timer = a.intervalId;
    await press("weekly");
    mock.timers.tick(1000);
    await press("session");
    assert.equal(a.intervalId, timer);
    mock.timers.tick(299_000);
    await flush();
    assert.equal(calls.fetch, 2);
    mock.timers.tick(300_000);
    await flush();
    assert.equal(calls.fetch, 3);
    a.stopMonitoring();
}));

test("reset: new credentials may fetch at once", withClock(async () => {
    const { a, calls, press } = setup(new ProgressBars(), async () => claudeResult, claudeTiles);
    await press("weekly");
    a.resetFetchGap("");
    await press("weekly");
    assert.equal(calls.fetch, 2);
}));
