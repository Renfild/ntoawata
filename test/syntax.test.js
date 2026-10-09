import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import test from "node:test";

// The browser modules import three.js, so they cannot be loaded here; `node --check` still catches typos.
test("every browser module parses", () => {
  const dir = new URL("../js/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".js"))) {
    const result = spawnSync(process.execPath, ["--check", new URL(file, dir).pathname], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});
