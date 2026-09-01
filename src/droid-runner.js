import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {reportProgress} from "./callbacks.js";
import {createProgressParser, parseInstructions} from "./droid-progress.js";

const TIMEOUT_MS = 40 * 60 * 1000;

export function createDroidArgs({apkPath, testPaths, contextPath, reportPath}) {
  const args = [
    "run", ...testPaths,
    "--llm-provider", "loadmill",
    "--cua-model", "loadmill-pulse",
    "--device-source", "loadmill-cloud",
    "--platform", "android",
    "--device-name", "Google Pixel 8",
    "--os-version", "14",
    "--app", apkPath,
    "--artifacts", "video",
    "--report", reportPath,
    "--debug",
  ];
  if (contextPath) args.push("--context", contextPath);
  return args;
}

function classify({exitCode, signal, timedOut, reportExists}) {
  if (timedOut) return "infrastructure_failed";
  if (exitCode === 130 || signal === "SIGINT" || signal === "SIGTERM") {
    return "cancelled";
  }
  if (exitCode === 0) return reportExists ? "passed" : "infrastructure_failed";
  return reportExists ? "test_failed" : "infrastructure_failed";
}

async function collectDirectory(source, destination) {
  await fs.cp(source, destination, {recursive: true}).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function reportStatus(outputDirectory, reportFile) {
  if (!reportFile) return null;
  const html = await fs.readFile(path.join(outputDirectory, reportFile), "utf8").catch(() => "");
  const status = html.match(/class="dc-pill dc-pill-(pass|fail|error|stopped|skipped)"/)?.[1];
  if (status === "pass") return "passed";
  if (status === "stopped") return "cancelled";
  if (status === "fail" || status === "error") return "test_failed";
  return null;
}

export async function runDroid({
  executable,
  apkPath,
  testPaths,
  repositoryTestPaths,
  contextPath,
  workspace,
  outputDirectory,
  startedAt,
  environment = process.env,
  spawnProcess = spawn,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
}) {
  await fs.mkdir(outputDirectory, {recursive: true});
  const reportPath = path.join(outputDirectory, "report.html");
  const logPath = path.join(outputDirectory, "runner.log");
  let updates = Promise.resolve();
  const tests = await Promise.all(testPaths.map(async (testPath, index) => {
    const instructions = parseInstructions(await fs.readFile(testPath, "utf8"));
    const state = {
      testPath: repositoryTestPaths[index], instructions,
      reportFile: null, startedAt: Date.now(), finishedAt: null,
    };
    state.parser = createProgressParser({
      instructions,
      publish(stage, details = {}) {
        updates = updates.then(() => reportProgress({
          stage, ...details, startedAt, testPath: state.testPath,
          environment, fetchImpl,
        }));
      },
    });
    return state;
  }));
  let activeIndex = 0;

  function parseRunnerLine(rawLine) {
    const value = rawLine.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim();
    const boundary = value.match(/^\[(\d+)\/(\d+)\]\s+/);
    if (boundary) {
      if (tests[activeIndex] && Number(boundary[1]) - 1 !== activeIndex) {
        tests[activeIndex].finishedAt ??= Date.now();
      }
      activeIndex = Number(boundary[1]) - 1;
      if (tests[activeIndex]) tests[activeIndex].startedAt = Date.now();
    }
    const active = tests[activeIndex];
    if (!active) return;
    if (value.startsWith("HTML report saved: ")) {
      const candidate = path.resolve(value.slice("HTML report saved: ".length));
      const relative = path.relative(outputDirectory, candidate);
      if (relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
        active.reportFile = relative;
        active.parser.line("Ending Loadmill Cloud session...");
      }
    }
    active.parser.line(rawLine);
  }

  const args = createDroidArgs({apkPath, testPaths, contextPath, reportPath});
  const child = spawnProcess(executable, args, {
    cwd: workspace,
    env: {...process.env, LOADMILL_API_TOKEN: environment.LOADMILL_API_TOKEN},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const buffers = {stdout: "", stderr: ""};

  function capture(chunk, stream, destination) {
    const text = chunk.toString();
    log += text;
    destination.write(chunk);
    const lines = `${buffers[stream]}${text}`.split(/\r?\n/);
    buffers[stream] = lines.pop() ?? "";
    lines.forEach(parseRunnerLine);
  }

  child.stdout?.on("data", (chunk) => capture(chunk, "stdout", process.stdout));
  child.stderr?.on("data", (chunk) => capture(chunk, "stderr", process.stderr));

  let timedOut = false;
  let forceKill;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 15_000);
  }, timeoutMs);
  const forwardSignal = (signal) => child.kill(signal);
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  let exitCode;
  let signal;
  try {
    ({exitCode, signal} = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, closedBy) => resolve({exitCode: code, signal: closedBy}));
    }));
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceKill);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await fs.writeFile(logPath, log, {mode: 0o600});
  }

  parseRunnerLine(buffers.stdout);
  parseRunnerLine(buffers.stderr);
  await updates;
  const reportExists = await fs.access(reportPath).then(() => true, () => false);
  await Promise.all([
    collectDirectory(path.join(workspace, "logs"), path.join(outputDirectory, "logs")),
    collectDirectory(
      path.join(workspace, "droid-cua-artifacts"),
      path.join(outputDirectory, "droid-cua-artifacts"),
    ),
  ]);
  const endedAt = Date.now();
  tests[activeIndex].finishedAt ??= endedAt;
  if (tests.length === 1 && reportExists) tests[0].reportFile ??= "report.html";
  const results = await Promise.all(tests.map(async (test) => {
    const reportedStatus = await reportStatus(outputDirectory, test.reportFile);
    const testStatus = reportedStatus ?? classify({
      exitCode, signal, timedOut, reportExists: false,
    });
    const testExitCode = testStatus === "passed" ? 0
      : testStatus === "test_failed" ? 1
        : testStatus === "cancelled" ? 130 : null;
    return {
      status: testStatus,
      detail: timedOut && !test.reportFile ? "Droid CUA exceeded the 40 minute timeout" : null,
      durationSeconds: Math.max(0, Math.round(((test.finishedAt ?? endedAt) - test.startedAt) / 1000)),
      exitCode: testExitCode,
      test: {path: test.testPath, ...test.parser.result(testExitCode)},
      loadmillRun: null,
      reportFile: test.reportFile,
      logFile: "runner.log",
    };
  }));
  if (results.every((result) => result.status === "passed") && exitCode !== 0) {
    const last = results[Math.min(activeIndex, results.length - 1)];
    if (timedOut) {
      Object.assign(last, {
        status: "infrastructure_failed",
        detail: "Droid CUA exceeded the 40 minute timeout",
        exitCode: null,
      });
    } else if (exitCode === 130 || signal === "SIGINT" || signal === "SIGTERM") {
      Object.assign(last, {status: "cancelled", detail: null, exitCode: 130});
    } else {
      Object.assign(last, {
        status: "infrastructure_failed",
        detail: `Droid CUA exited with code ${exitCode} after reporting all tests passed`,
        exitCode,
      });
    }
  }
  const status = ["infrastructure_failed", "cancelled", "test_failed"]
    .find((candidate) => results.some((result) => result.status === candidate)) ?? "passed";
  return {status, results};
}
