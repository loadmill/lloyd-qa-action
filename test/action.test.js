import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("action metadata wires the frozen inputs and trusted artifact actions", async () => {
  const metadata = await fs.readFile(new URL("../action.yml", import.meta.url), "utf8");
  for (const input of [
    "job_id",
    "pr_number",
    "pr_sha",
    "test_paths",
    "context_path",
    "apk_workflow_run_id",
    "apk_artifact_name",
  ]) {
    assert.match(metadata, new RegExp(`^  ${input}:`, "m"));
  }
  assert.doesNotMatch(metadata, /^  test_path:/m);
  assert.match(metadata, /uses: actions\/setup-node@v4/);
  assert.match(metadata, /node-version: 20/);
  assert.match(metadata, /uses: actions\/checkout@v4/);
  assert.match(metadata, /ref: \$\{\{ inputs\.pr_sha \}\}/);
  assert.match(metadata, /uses: actions\/download-artifact@v8/);
  assert.match(metadata, /run-id: \$\{\{ inputs\.apk_workflow_run_id \}\}/);
  assert.match(metadata, /skip-decompress: true/);
  assert.match(metadata, /uses: actions\/upload-artifact@v4/);
  assert.doesNotMatch(metadata, /github\.workspace.*(?:logs|droid-cua-artifacts)/);
  assert.match(metadata, /@loadmill\/droid-cua@2\.36\.0/);
});
