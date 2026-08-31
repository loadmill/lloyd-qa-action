import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {PassThrough} from "node:stream";
import test from "node:test";
import {runDroid} from "../src/droid-runner.js";
import {parseInstructions} from "../src/droid-progress.js";

const callbackEnvironment = {
  LLOYD_JOB_ID: "job-123",
  LOADMILL_API_TOKEN: "token",
  GITHUB_RUN_ID: "100",
  GITHUB_RUN_ATTEMPT: "1",
};

test("parses the same executable instruction lines as Droid", () => {
  assert.deepEqual(
    parseInstructions(
      "// note\nOpen https://example.com\nTap Login // comment\n\n",
    ),
    ["Open https://example.com", "Tap Login"],
  );
});

test("spawns Droid with an argument array and reports parsed progress", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-runner-"));
  const outputDirectory = path.join(root, "results");
  const testPath = path.join(root, "unsafe name; echo nope.dcua");
  await fs.writeFile(testPath, "Open app\nVerify home\n");
  let invocation;
  const callbacks = [];

  function spawnProcess(executable, args, options) {
    invocation = {executable, args, options};
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(async () => {
      child.stdout.write("Provisioning Loadmill Cloud device\n");
      child.stdout.write("Connected to Loadmill Cloud device mtc_test\n");
      child.stdout.write("Open app\nVerify home\n");
      child.stdout.write("Test completed successfully.\n");
      const reportPath = args[args.indexOf("--report") + 1];
      await fs.writeFile(reportPath, "<html></html>");
      child.emit("close", 0, null);
    });
    return child;
  }

  try {
    const result = await runDroid({
      executable: "/tmp/lloyd-tools/node_modules/.bin/droid-cua",
      apkPath: path.join(root, "app.apk"),
      testPath,
      repositoryTestPath: "tests/unsafe name; echo nope.dcua",
      contextPath: path.join(root, "context.md"),
      workspace: root,
      outputDirectory,
      startedAt: Date.now(),
      environment: callbackEnvironment,
      spawnProcess,
      fetchImpl: async (url, options) => {
        callbacks.push({url, body: JSON.parse(options.body)});
        return {ok: true, status: 200};
      },
    });

    assert.equal(result.status, "passed");
    assert.match(invocation.executable, /node_modules\/\.bin\/droid-cua$/);
    assert.equal(invocation.options.shell, undefined);
    assert.equal(invocation.options.cwd, root);
    assert.equal(invocation.options.env.LOADMILL_API_TOKEN, "token");
    assert.ok(invocation.args.includes("Google Pixel 8"));
    assert.ok(invocation.args.includes("14"));
    assert.ok(invocation.args.includes("loadmill-cloud"));
    assert.ok(invocation.args.includes(testPath));
    assert.deepEqual(
      callbacks.map(({body}) => body.stage),
      [
        "provisioning",
        "connected",
        "running_instruction",
        "running_instruction",
        "collecting_results",
      ],
    );
    assert.equal(result.test.totalInstructions, 2);
    assert.equal(result.test.completedInstructions, 2);
    assert.equal(result.reportFile, "report.html");
    assert.equal(result.logFile, "runner.log");
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test("classifies a CLI failure with a report as test_failed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-failure-"));
  const testPath = path.join(root, "test.dcua");
  await fs.writeFile(testPath, "Verify home\n");
  function spawnProcess(_executable, args) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(async () => {
      await fs.writeFile(args[args.indexOf("--report") + 1], "report");
      child.emit("close", 1, null);
    });
    return child;
  }
  try {
    const result = await runDroid({
      executable: "droid-cua",
      apkPath: path.join(root, "app.apk"),
      testPath,
      repositoryTestPath: "test.dcua",
      contextPath: null,
      workspace: root,
      outputDirectory: path.join(root, "results"),
      startedAt: Date.now(),
      environment: callbackEnvironment,
      spawnProcess,
    });
    assert.equal(result.status, "test_failed");
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
