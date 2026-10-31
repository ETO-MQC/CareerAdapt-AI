import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { patchCareerAdaptTimeoutLookup, patchCareerAdaptMcpDedup } from "../scripts/hermes-efficiency-patch.mjs";

test("efficiency patches are shape-checked, idempotent, and preserve nonmatching paths", () => {
  const root = ".electron-build/hermes-runtime-v4/source/";
  for (const [file, patch] of [["hermes_cli/timeouts.py", patchCareerAdaptTimeoutLookup], ["tools/mcp_tool.py", patchCareerAdaptMcpDedup]]) {
    const source = fs.readFileSync(root + file, "utf8");
    assert.equal(patch(source), source);
    assert.throws(() => patch("unexpected upstream"), /shape changed/u);
  }
});
