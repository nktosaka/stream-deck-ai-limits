import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Bundles each test with the sources it covers, so the tests run on plain
 * `node --test` without a TypeScript loader. The Stream Deck SDK is swapped for a
 * stub; other dependencies stay external and load from node_modules.
 */
const tests = readdirSync("test").filter((file) => file.endsWith(".test.ts"));
const stub = path.resolve("test/stubs/streamdeck.ts");

/** @type {import('rollup').RollupOptions} */
export default {
	input: Object.fromEntries(tests.map((file) => [file.replace(/\.ts$/, ""), `test/${file}`])),
	output: { dir: "tmp/test", format: "es", entryFileNames: "[name].mjs" },
	external: (id) => /^(node:|@lenadweb\/|google-auth-library|strip-ansi)/.test(id),
	plugins: [
		{
			// Stale chunks would otherwise pile up next to the fresh ones.
			name: "clean-output",
			buildStart: () => rmSync("tmp/test", { recursive: true, force: true })
		},
		{
			name: "stub-streamdeck",
			resolveId: (id) => (id === "@elgato/streamdeck" ? stub : null)
		},
		typescript({ tsconfig: "tsconfig.test.json", outDir: "tmp/test", noEmitOnError: true }),
		nodeResolve({ exportConditions: ["node"], preferBuiltins: true }),
		commonjs(),
		json()
	]
};
