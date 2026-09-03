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

function htmlReport(status) {
  return `<span class="dc-pill dc-pill-${status}">${status}</span>`;
}

test("parses the same executable instruction lines as Droid", () => {
  assert.deepEqual(
    parseInstructions(
      "// note\nOpen https://example.com\nTap Login // comment\n\n",
    ),
    ["Open https://example.com", "Tap Login"],
  );
});

test("runs selected tests in one process and reports each result", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-runner-"));
  const outputDirectory = path.join(root, "results");
  const testPaths = [
    path.join(root, "unsafe name; echo nope.dcua"),
    path.join(root, "checkout.dcua"),
  ];
  await fs.writeFile(testPaths[0], "Open app\nVerify home\n");
  await fs.writeFile(testPaths[1], "Open cart\n");
  await fs.mkdir(path.join(root, "logs"));
  await fs.mkdir(path.join(root, "droid-cua-artifacts"));
  await fs.writeFile(path.join(root, "logs", "debug.jsonl"), "debug");
  await fs.writeFile(path.join(root, "droid-cua-artifacts", "video.mp4"), "video");
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
      child.stdout.write("[1/2] tests/unsafe name; echo nope.dcua\n");
      child.stdout.write("Debug logging enabled: /tmp/execution-run-100-debug.jsonl\n");
      child.stdout.write("Open app\nVerify home\n");
      const firstReport = path.join(outputDirectory, "login--report.html");
      await fs.writeFile(firstReport, htmlReport("fail"));
      child.stdout.write(`HTML report saved: ${firstReport}\n`);
      child.stdout.write("[2/2] tests/checkout.dcua\n");
      child.stdout.write("Debug logging enabled: /tmp/execution-run-101-2-debug.jsonl\n");
      // stderr may arrive after the next stdout boundary; report status remains authoritative.
      child.stderr.write("Test failed: first test assertion failed\n");
      child.stdout.write("Open cart\n");
      child.stdout.write("Test completed successfully.\n");
      const secondReport = path.join(outputDirectory, "checkout--report.html");
      await fs.writeFile(secondReport, htmlReport("pass"));
      child.stdout.write(`HTML report saved: ${secondReport}\n`);
      const reportPath = args[args.indexOf("--report") + 1];
      await fs.writeFile(reportPath, "<html></html>");
      child.emit("close", 1, null);
    });
    return child;
  }

  try {
    const batch = await runDroid({
      executable: "/tmp/lloyd-tools/node_modules/.bin/droid-cua",
      apkPath: path.join(root, "app.apk"),
      testPaths,
      repositoryTestPaths: [
        "tests/unsafe name; echo nope.dcua", "tests/checkout.dcua",
      ],
      contextPath: path.join(root, "context.md"),
      workspace: root,
      outputDirectory,
      startedAt: Date.now(),
      environment: callbackEnvironment,
      spawnProcess,
      resolveLoadmillRun: async (input) => {
        assert.deepEqual(input.localRunIds, ["run-100", "run-101-2"]);
        assert.equal(input.testCount, 2);
        return {
          id: "c87ec69f-d3cd-44f1-9f80-49dd87a9bb53",
          url: "https://app.loadmill.com/app/api-tests/droid-runs/c87ec69f-d3cd-44f1-9f80-49dd87a9bb53",
        };
      },
      fetchImpl: async (url, options) => {
        callbacks.push({url, body: JSON.parse(options.body)});
        return {ok: true, status: 200};
      },
    });

    assert.equal(batch.status, "test_failed");
    assert.deepEqual(batch.results.map((result) => result.status), ["test_failed", "passed"]);
    assert.match(invocation.executable, /node_modules\/\.bin\/droid-cua$/);
    assert.equal(invocation.options.shell, undefined);
    assert.equal(invocation.options.cwd, root);
    assert.equal(invocation.options.env.LOADMILL_API_TOKEN, "token");
    assert.ok(invocation.args.includes("Google Pixel 8"));
    assert.ok(invocation.args.includes("14"));
    assert.ok(invocation.args.includes("loadmill-cloud"));
    assert.deepEqual(invocation.args.slice(0, 3), ["run", ...testPaths]);
    assert.equal(invocation.args.includes("--instructions"), false);
    assert.ok(callbacks.some(({body}) =>
      body.test.path === "tests/checkout.dcua" && body.stage === "running_instruction"));
    assert.equal(batch.results[0].test.totalInstructions, 2);
    assert.equal(batch.results[0].test.completedInstructions, 1);
    assert.equal(batch.results[0].reportFile, "login--report.html");
    assert.equal(batch.results[1].reportFile, "checkout--report.html");
    assert.equal(batch.results[0].logFile, "runner.log");
    assert.deepEqual(batch.results[0].loadmillRun, batch.results[1].loadmillRun);
    assert.equal(
      await fs.readFile(path.join(outputDirectory, "logs", "debug.jsonl"), "utf8"),
      "debug",
    );
    assert.equal(
      await fs.readFile(
        path.join(outputDirectory, "droid-cua-artifacts", "video.mp4"),
        "utf8",
      ),
      "video",
    );
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
      child.stderr.write("Test failed: assertion failed\n");
      await fs.writeFile(args[args.indexOf("--report") + 1], htmlReport("fail"));
      child.emit("close", 1, null);
    });
    return child;
  }
  try {
    const result = await runDroid({
      executable: "droid-cua",
      apkPath: path.join(root, "app.apk"),
      testPaths: [testPath],
      repositoryTestPaths: ["test.dcua"],
      contextPath: null,
      workspace: root,
      outputDirectory: path.join(root, "results"),
      startedAt: Date.now(),
      environment: callbackEnvironment,
      spawnProcess,
    });
    assert.equal(result.status, "test_failed");
    assert.equal(result.results[0].status, "test_failed");
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});

test("classifies an unexplained nonzero exit after a passing report as infrastructure_failed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-exit-"));
  const testPath = path.join(root, "test.dcua");
  await fs.writeFile(testPath, "Verify home\n");
  function spawnProcess(_executable, args) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(async () => {
      await fs.writeFile(args[args.indexOf("--report") + 1], htmlReport("pass"));
      child.emit("close", 1, null);
    });
    return child;
  }
  try {
    const batch = await runDroid({
      executable: "droid-cua",
      apkPath: path.join(root, "app.apk"),
      testPaths: [testPath],
      repositoryTestPaths: ["test.dcua"],
      contextPath: null,
      workspace: root,
      outputDirectory: path.join(root, "results"),
      startedAt: Date.now(),
      environment: callbackEnvironment,
      spawnProcess,
    });
    assert.equal(batch.status, "infrastructure_failed");
    assert.match(batch.results[0].detail, /exited with code 1/);
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
});
