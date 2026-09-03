import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactNameForJob,
  callbackUrl,
  loadmillBaseUrl,
} from "../src/contract.js";
import {postCallback, progressPayload, reportProgress} from "../src/callbacks.js";

const environment = {
  LLOYD_JOB_ID: "job/123",
  LOADMILL_API_TOKEN: "secret-token",
  LOADMILL_BASE_URL: "https://staging.loadmill.example/",
  GITHUB_RUN_ID: "101",
  GITHUB_RUN_ATTEMPT: "2",
};

test("normalizes the callback base URL and encodes the job ID", () => {
  assert.equal(loadmillBaseUrl(undefined), "https://app.loadmill.com");
  assert.equal(
    callbackUrl({
      baseUrl: "https://staging.loadmill.example///",
      jobId: "job/123",
      endpoint: "progress",
    }),
    "https://staging.loadmill.example/api/lloyd/jobs/job%2F123/progress",
  );
});

test("uses a deterministic artifact name without embedding the job ID", () => {
  const first = artifactNameForJob("customer/job:123");
  assert.equal(first, artifactNameForJob("customer/job:123"));
  assert.match(first, /^lloyd-results-[0-9a-f]{20}$/);
  assert.doesNotMatch(first, /customer/);
});

test("posts authenticated JSON callbacks", async () => {
  let request;
  await postCallback({
    endpoint: "complete",
    payload: {version: 1},
    environment,
    fetchImpl: async (url, options) => {
      request = {url, options};
      return {ok: true, status: 200};
    },
  });
  assert.equal(
    request.url,
    "https://staging.loadmill.example/api/lloyd/jobs/job%2F123/complete",
  );
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer secret-token");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), {version: 1});
});

test("builds the frozen progress payload", () => {
  const payload = progressPayload({
    stage: "running_instruction",
    startedAt: Date.now(),
    testPath: "tests/login.dcua",
    current: 1,
    total: 3,
    instruction: "Open the app",
    environment,
  });
  assert.deepEqual(payload, {
    version: 1,
    stage: "running_instruction",
    elapsedSeconds: 0,
    test: {
      path: "tests/login.dcua",
      current: 1,
      total: 3,
      instruction: "Open the app",
    },
    github: {runId: "101", runAttempt: "2"},
  });
});

test("a progress callback failure is non-fatal", async () => {
  await assert.doesNotReject(() =>
    reportProgress({
      stage: "connected",
      startedAt: Date.now(),
      testPath: "tests/login.dcua",
      environment,
      fetchImpl: async () => ({ok: false, status: 503}),
    }),
  );
});
