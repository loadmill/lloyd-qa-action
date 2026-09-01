import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {run} from "../src/run.js";
import {STATE_FILE, writeJson} from "../src/job-files.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-run-main-"));
  const workspace = path.join(root, "workspace");
  const apkDirectory = path.join(root, "apk");
  const resultsDirectory = path.join(root, "results");
  await fs.mkdir(path.join(workspace, "tests"), {recursive: true});
  await fs.mkdir(apkDirectory);
  await fs.writeFile(path.join(workspace, "tests", "login.dcua"), "Open app\n");
  await fs.writeFile(path.join(workspace, "tests", "checkout.dcua"), "Open cart\n");
  await fs.writeFile(path.join(workspace, "tests", "context.md"), "context\n");
  await fs.writeFile(path.join(apkDirectory, "app.apk"), "apk");
  await execFileAsync("git", ["init", "-q"], {cwd: workspace});
  await execFileAsync("git", ["add", "."], {cwd: workspace});
  await execFileAsync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
    {cwd: workspace},
  );
  const {stdout} = await execFileAsync("git", ["rev-parse", "HEAD"], {cwd: workspace});
  await writeJson(resultsDirectory, STATE_FILE, {startedAt: Date.now()});
  return {root, workspace, apkDirectory, resultsDirectory, sha: stdout.trim()};
}

function environment(value) {
  return {
    LLOYD_JOB_ID: "job-1",
    LLOYD_PR_NUMBER: "12",
    LLOYD_PR_SHA: value.sha,
    LLOYD_TEST_PATHS: '["tests/login.dcua","tests/checkout.dcua"]',
    LLOYD_CONTEXT_PATH: "tests/context.md",
    LLOYD_APK_WORKFLOW_RUN_ID: "1001",
    LLOYD_APK_ARTIFACT_NAME: "app-debug-12",
    LLOYD_APK_DIR: value.apkDirectory,
    LLOYD_RESULTS_DIR: value.resultsDirectory,
    LLOYD_DROID_EXECUTABLE: "/tmp/lloyd-tools/node_modules/.bin/droid-cua",
    LOADMILL_API_TOKEN: "token",
    GITHUB_ACTION_PATH: "/action",
    GITHUB_WORKSPACE: value.workspace,
    GITHUB_RUN_ID: "500",
    GITHUB_RUN_ATTEMPT: "1",
  };
}

test("prepares validated files only after verifying the exact checkout SHA", async () => {
  const value = await fixture();
  let invocation;
  try {
    const result = await run(environment(value), {
      fetchImpl: async () => ({ok: true, status: 200}),
      runDroid: async (input) => {
        invocation = input;
        return {status: "passed", results: input.repositoryTestPaths.map((testPath) => ({
          status: "passed", detail: null, durationSeconds: 1, exitCode: 0,
          test: {path: testPath, totalInstructions: 1, completedInstructions: 1,
            currentInstruction: null},
          loadmillRun: null, reportFile: "report.html", logFile: "runner.log",
        }))};
      },
    });
    assert.equal(result.status, "passed");
    assert.deepEqual(invocation.repositoryTestPaths, [
      "tests/login.dcua", "tests/checkout.dcua",
    ]);
    assert.deepEqual(invocation.testPaths, await Promise.all([
      fs.realpath(path.join(value.workspace, "tests", "login.dcua")),
      fs.realpath(path.join(value.workspace, "tests", "checkout.dcua")),
    ]));
    assert.equal(
      invocation.contextPath,
      await fs.realpath(path.join(value.workspace, "tests", "context.md")),
    );
    assert.equal(
      invocation.apkPath,
      await fs.realpath(path.join(value.apkDirectory, "app.apk")),
    );
    assert.equal(invocation.workspace, value.workspace);
  } finally {
    await fs.rm(value.root, {recursive: true, force: true});
  }
});

test("a checkout SHA mismatch is an infrastructure failure", async () => {
  const value = await fixture();
  const env = environment(value);
  env.LLOYD_PR_SHA = "0".repeat(40);
  try {
    const result = await run(env, {
      fetchImpl: async () => ({ok: true, status: 200}),
      runDroid: async () => {
        throw new Error("must not execute");
      },
    });
    assert.equal(result.status, "infrastructure_failed");
    assert.equal(result.results.length, 2);
    assert.match(result.results[0].detail, /does not match pr_sha/);
  } finally {
    await fs.rm(value.root, {recursive: true, force: true});
  }
});
