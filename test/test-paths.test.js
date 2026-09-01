import assert from "node:assert/strict";
import test from "node:test";
import {parseTestPaths} from "../src/test-paths.js";

test("parses an ordered non-empty JSON test path array", () => {
  assert.deepEqual(parseTestPaths('["tests/a.dcua","tests/b.dcua"]'), [
    "tests/a.dcua", "tests/b.dcua",
  ]);
});

test("rejects invalid, duplicate, and non-dcua selections", () => {
  assert.throws(() => parseTestPaths("not json"), /JSON array/);
  assert.throws(() => parseTestPaths("[]"), /at least one/);
  assert.throws(() => parseTestPaths('["a.dcua","a.dcua"]'), /duplicate/);
  assert.throws(() => parseTestPaths('["README.md"]'), /.dcua files/);
});
