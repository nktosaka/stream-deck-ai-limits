import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Node 20 does not expand a quoted wildcard on Windows or Linux. Pass every
// generated test file explicitly so CI uses the same list on both systems.
const files = readdirSync("tmp/test")
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => resolve("tmp/test", name))
    .sort();
files.push(resolve("test/statusline-bridge.test.mjs"));
if (files.length < 2) throw new Error("Expected compiled regression test modules");

const run = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (run.error) throw run.error;
process.exit(run.status ?? 1);
