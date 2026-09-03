import assert from "node:assert/strict";
import test from "node:test";
import {resolveLoadmillDroidRun} from "../src/loadmill-run.js";

const savedId = "c87ec69f-d3cd-44f1-9f80-49dd87a9bb53";

function response(runs) {
  return {ok: true, json: async () => ({runs})};
}

test("resolves a single test by its Droid run ID", async () => {
  const result = await resolveLoadmillDroidRun({
    token: "token",
    localRunIds: ["run-123"],
    projectName: "repository",
    testCount: 1,
    startedAt: 1_000,
    endedAt: 2_000,
    baseUrl: "https://app.loadmill.com/api",
    fetchImpl: async () => response([{id: savedId, runId: "run-123"}]),
  });

  assert.deepEqual(result, {
    id: savedId,
    url: `https://app.loadmill.com/app/api-tests/droid-runs/${savedId}`,
  });
});

test("resolves the combined report for multiple selected tests", async () => {
  const result = await resolveLoadmillDroidRun({
    token: "token",
    localRunIds: ["run-100", "run-101"],
    projectName: "maker-checker-android",
    testCount: 2,
    startedAt: 1_000,
    endedAt: 3_000,
    baseUrl: "https://local.example/llm/v1",
    fetchImpl: async () => response([
      {
        id: savedId,
        runId: "run-200",
        source: "ci",
        project: "maker-checker-android",
        testName: "Selected tests",
        completedAt: 2_900,
        hasReport: true,
        payload: {runType: "project", testCases: 2},
      },
      {
        id: "7e11db68-112a-4e74-82d1-30556d84c83a",
        runId: "run-100",
        source: "ci",
        project: "tests",
        testName: "login.dcua",
        completedAt: 2_000,
        hasReport: true,
        payload: {runType: "test", testCases: 1},
      },
    ]),
  });

  assert.deepEqual(result, {
    id: savedId,
    url: `https://local.example/app/api-tests/droid-runs/${savedId}`,
  });
});

test("does not guess when concurrent aggregate runs are ambiguous", async () => {
  const aggregate = {
    id: savedId,
    source: "ci",
    project: "repository",
    testName: "Selected tests",
    completedAt: 2_000,
    hasReport: true,
    payload: {runType: "project", testCases: 2},
  };
  const result = await resolveLoadmillDroidRun({
    token: "token",
    localRunIds: ["run-100", "run-101"],
    projectName: "repository",
    testCount: 2,
    startedAt: 1_000,
    endedAt: 3_000,
    fetchImpl: async () => response([
      aggregate,
      {...aggregate, id: "7e11db68-112a-4e74-82d1-30556d84c83a"},
    ]),
  });

  assert.equal(result, null);
});
