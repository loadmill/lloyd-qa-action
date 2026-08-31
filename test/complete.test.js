import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {complete} from "../src/complete.js";
import {writeResult} from "../src/job-files.js";
import {completionPayload} from "../src/results.js";

function environment(resultsDirectory) {
  return {
    LLOYD_JOB_ID: "job-123",
    LLOYD_TEST_PATH: "tests/login.dcua",
    LLOYD_RESULTS_DIR: resultsDirectory,
    LLOYD_RESULTS_ARTIFACT_NAME: "lloyd-results-fixed",
    LLOYD_INITIALIZE_OUTCOME: "success",
    LLOYD_RUN_OUTCOME: "success",
    LLOYD_UPLOAD_OUTCOME: "success",
    LOADMILL_API_TOKEN: "token",
    GITHUB_RUN_ID: "10",
    GITHUB_RUN_ATTEMPT: "1",
  };
}

const passedResult = {
  status: "passed",
  detail: null,
  durationSeconds: 42,
  exitCode: 0,
  test: {
    path: "tests/login.dcua",
    totalInstructions: 2,
    completedInstructions: 2,
    currentInstruction: {current: 2, total: 2, instruction: "Verify home"},
  },
  loadmillRun: {id: "run-id", url: "https://app.loadmill.com/run"},
  reportFile: "report.html",
  logFile: "runner.log",
};

test("builds exactly the frozen completion payload", () => {
  assert.deepEqual(
    completionPayload({
      result: passedResult,
      artifactName: "lloyd-results-fixed",
      environment: environment("/tmp/results"),
    }),
    {
      version: 1,
      status: "passed",
      detail: null,
      durationSeconds: 42,
      exitCode: 0,
      test: passedResult.test,
      loadmillRun: passedResult.loadmillRun,
      artifacts: {
        name: "lloyd-results-fixed",
        reportFile: "report.html",
        logFile: "runner.log",
      },
      github: {runId: "10", runAttempt: "1"},
    },
  );
});

test("posts completion after reading the structured result", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-complete-"));
  await writeResult(directory, passedResult);
  let payload;
  try {
    const result = await complete(environment(directory), async (_url, options) => {
      payload = JSON.parse(options.body);
      return {ok: true, status: 200};
    });
    assert.equal(result.status, "passed");
    assert.equal(payload.status, "passed");
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test("an artifact upload failure becomes infrastructure_failed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-upload-"));
  await writeResult(directory, passedResult);
  const env = environment(directory);
  env.LLOYD_UPLOAD_OUTCOME = "failure";
  let payload;
  try {
    const result = await complete(env, async (_url, options) => {
      payload = JSON.parse(options.body);
      return {ok: true, status: 200};
    });
    assert.equal(result.status, "infrastructure_failed");
    assert.equal(payload.status, "infrastructure_failed");
    assert.match(payload.detail, /artifact upload failure/);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test("a completion callback failure is fatal", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-callback-"));
  await writeResult(directory, passedResult);
  try {
    await assert.rejects(
      complete(environment(directory), async () => ({ok: false, status: 503})),
      /complete callback failed/,
    );
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
