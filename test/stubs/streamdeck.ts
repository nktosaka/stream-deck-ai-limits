/**
 * Stand-in for @elgato/streamdeck in the test bundle: the real SDK connects to the
 * Stream Deck app on import, which a unit test has no app to connect to.
 */
const logger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };

export default { logger };

export class SingletonAction<_T = unknown> {}

export function action(_manifest: { UUID: string }) {
    return <C>(target: C, _context?: unknown): C => target;
}

export type KeyDownEvent<_T> = any;
export type WillAppearEvent<_T> = any;
export type WillDisappearEvent<_T> = any;
