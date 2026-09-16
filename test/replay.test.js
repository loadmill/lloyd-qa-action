import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {discoverReplay, registerReplay} from "../src/replay.js";
import {writeResult} from "../src/job-files.js";

const sessionId = "mtc_12345678-1234-1234-1234-123456789abc";
const droidRunId = "d3f3fca7-d8b0-4c39-a4fb-bc925b286edf";

function environment(directory) {
  return {
    LLOYD_JOB_ID: "job-1",
    LLOYD_RESULTS_DIR: directory,
    LOADMILL_API_TOKEN: "token",
    GITHUB_RUN_ID: "10",
    GITHUB_RUN_ATTEMPT: "2",
  };
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-replay-"));
  const sessionDirectory = path.join(directory, "droid-cua-artifacts", sessionId);
  await fs.mkdir(sessionDirectory, {recursive: true});
  await fs.writeFile(path.join(sessionDirectory, "video.mp4"), "recording");
  await writeResult(directory, {
    status: "passed",
    results: [{
      test: {path: "tests/login.dcua"},
      loadmillRun: {id: droidRunId, url: "https://app.loadmill.com/run"},
    }],
  });
  return {directory, sessionDirectory};
}

test("discovers recordings under their exact Loadmill Cloud session", async () => {
  const {directory} = await fixture();
  try {
    const sessions = await discoverReplay(directory);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, sessionId);
    assert.deepEqual(sessions[0].recordings.map(({index, size}) => ({index, size})), [
      {index: 0, size: Buffer.byteLength("recording")},
    ]);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test("registers verified metadata and removes the redundant local video", async () => {
  const {directory, sessionDirectory} = await fixture();
  let payload;
  try {
    const result = await registerReplay(environment(directory), async (_url, options) => {
      payload = JSON.parse(options.body);
      return {ok: true, status: 200};
    });
    assert.equal(result.registered, true);
    assert.deepEqual(payload, {
      version: 1,
      droidRunId,
      sessionId,
      recordings: [{index: 0, size: Buffer.byteLength("recording")}],
      testPath: "tests/login.dcua",
      github: {runId: "10", runAttempt: "2"},
    });
    await assert.rejects(fs.access(path.join(sessionDirectory, "video.mp4")));
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test("keeps the local video when registration fails", async () => {
  const {directory, sessionDirectory} = await fixture();
  try {
    await assert.rejects(
      registerReplay(environment(directory), async () => ({ok: false, status: 409})),
      /replay callback failed/,
    );
    await fs.access(path.join(sessionDirectory, "video.mp4"));
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
