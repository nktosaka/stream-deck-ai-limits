import { Slot, RenderOptions } from "../src/ui/progress-bar-renderer";

/**
 * Ring and bars inputs whose output must stay byte-identical to the renderer at
 * upstream d7e4163. The golden files were produced by that commit's renderer.
 */
export const RING_BAR_CASES: { name: string; kind: "ring" | "bars"; theme: "claude" | "codex"; slots: Slot[]; w: number; h: number; opts: RenderOptions }[] = [
    { name: "claude-ring-session", kind: "ring", theme: "claude", w: 144, h: 144, opts: {},
        slots: [{ kind: "gauge", label: "Session", percent: 0, caption: "2h 5m" }] },
    { name: "codex-ring-week-45", kind: "ring", theme: "codex", w: 144, h: 144, opts: { size: "large" },
        slots: [{ kind: "gauge", label: "Week", percent: 45, caption: "4d 17h" }] },
    { name: "claude-ring-dial-92", kind: "ring", theme: "claude", w: 200, h: 100, opts: { showName: false },
        slots: [{ kind: "gauge", label: "Week", percent: 92, caption: "5d 12h" }] },
    { name: "claude-bars-default", kind: "bars", theme: "claude", w: 144, h: 144, opts: {},
        slots: [
            { kind: "gauge", label: "Session", percent: 0, caption: "4h 59m" },
            { kind: "gauge", label: "Week", percent: 45, caption: "4d 17h" }
        ] },
    { name: "codex-bars-credits", kind: "bars", theme: "codex", w: 144, h: 144, opts: { size: "xlarge" },
        slots: [
            { kind: "gauge", label: "Week", percent: 75, caption: "5d 12h" },
            { kind: "stat", label: "Usage limit resets", shortLabel: "Resets", valueText: "2" }
        ] },
    { name: "codex-bars-dial", kind: "bars", theme: "codex", w: 200, h: 100, opts: { size: "compact" },
        slots: [
            { kind: "gauge", label: "Session", percent: 100, caption: "now" },
            { kind: "stat", label: "Week", valueText: "—", caption: "no data", muted: true }
        ] }
];
