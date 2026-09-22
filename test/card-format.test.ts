import { test } from "node:test";
import assert from "node:assert/strict";
import { formatResetTokyo, remainingPercent } from "../src/utils/card-format";

test("remaining: usage 0% leaves 100%", () => {
    assert.equal(remainingPercent(0), 100);
});

test("remaining: usage 100% leaves 0%", () => {
    assert.equal(remainingPercent(100), 0);
});

test("remaining: intermediate usage", () => {
    assert.equal(remainingPercent(45), 55);
    assert.equal(remainingPercent(32), 68);
    assert.equal(remainingPercent(33.4), 67);
    assert.equal(remainingPercent(33.6), 66);
});

test("remaining: clamps at both ends", () => {
    assert.equal(remainingPercent(-5), 100);
    assert.equal(remainingPercent(100.4), 0);
    assert.equal(remainingPercent(130), 0);
    assert.equal(remainingPercent(99.6), 0);
    assert.equal(remainingPercent(0.4), 100);
});

test("remaining: missing or broken usage counts as unused, like the ring's 0%", () => {
    assert.equal(remainingPercent(null), 100);
    assert.equal(remainingPercent(undefined), 100);
    assert.equal(remainingPercent(Number.NaN), 100);
});

test("reset: ISO time converts to Asia/Tokyo MM/DD HH:mm", () => {
    assert.equal(formatResetTokyo("2026-09-24T09:17:00Z"), "09/24 18:17");
    assert.equal(formatResetTokyo("2026-09-23T21:59:30.000Z"), "09/24 06:59");
    assert.equal(formatResetTokyo("2026-09-18T22:59:00+09:00"), "09/18 22:59");
});

test("reset: crosses day, month and year boundaries in Tokyo", () => {
    assert.equal(formatResetTokyo("2026-09-30T15:00:00Z"), "10/01 00:00");
    assert.equal(formatResetTokyo("2026-12-31T20:30:00Z"), "01/01 05:30");
    assert.equal(formatResetTokyo("2026-09-30T14:59:00Z"), "09/30 23:59");
});

test("reset: numbers are Unix seconds", () => {
    const seconds = Date.UTC(2026, 8, 24, 9, 17) / 1000;
    assert.equal(formatResetTokyo(seconds), "09/24 18:17");
});

test("reset: missing or unparsable time yields null", () => {
    assert.equal(formatResetTokyo(null), null);
    assert.equal(formatResetTokyo(undefined), null);
    assert.equal(formatResetTokyo(""), null);
    assert.equal(formatResetTokyo("not a date"), null);
});

test("reset: matches Intl's Asia/Tokyo across a year of timestamps", () => {
    const intl = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    });
    const expected = (ms: number) => {
        const p = Object.fromEntries(intl.formatToParts(ms).map((part) => [part.type, part.value]));
        return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
    };
    const start = Date.UTC(2026, 0, 1);
    for (let ms = start; ms < start + 366 * 86400000; ms += 7 * 3600000 + 13 * 60000) {
        assert.equal(formatResetTokyo(new Date(ms).toISOString()), expected(ms));
    }
});

test("reset: does not depend on the host timezone", () => {
    const original = process.env.TZ;
    try {
        for (const tz of ["America/Los_Angeles", "UTC", "Europe/London", "Asia/Tokyo"]) {
            process.env.TZ = tz;
            assert.equal(formatResetTokyo("2026-09-24T09:17:00Z"), "09/24 18:17", tz);
        }
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
});
