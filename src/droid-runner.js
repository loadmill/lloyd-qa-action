import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {reportProgress} from "./callbacks.js";
import {createProgressParser, parseInstructions} from "./droid-progress.js";

const TIMEOUT_MS = 25 * 60 * 1000;

export function createDroidArgs({apkPath, testPath, contextPath, reportPath}) {
  const args = [
    "--llm-provider", "loadmill",
    "--cua-model", "loadmill-pulse",
    "--device-source", "loadmill-cloud",
    "--platform", "android",
    "--device-name", "Google Pixel 8",
    "--os-version", "14",
    "--app", apkPath,
    "--instructions", testPath,
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

export async function runDroid({
  executable,
  apkPath,
  testPath,
  repositoryTestPath,
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
  const instructions = parseInstructions(await fs.readFile(testPath, "utf8"));
  let updates = Promise.resolve();
  const parser = createProgressParser({
    instructions,
    publish(stage, details = {}) {
      updates = updates.then(() =>
        reportProgress({
          stage,
          ...details,
          startedAt,
          testPath: repositoryTestPath,
          environment,
          fetchImpl,
        }),
      );
    },
  });

  const args = createDroidArgs({apkPath, testPath, contextPath, reportPath});
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
    lines.forEach(parser.line);
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

  parser.line(buffers.stdout);
  parser.line(buffers.stderr);
  await updates;
  const reportExists = await fs.access(reportPath).then(() => true, () => false);
  const status = classify({exitCode, signal, timedOut, reportExists});

  return {
    status,
    detail: timedOut ? "Droid CUA exceeded the 25 minute timeout" : null,
    durationSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    exitCode,
    test: {
      path: repositoryTestPath,
      ...parser.result(exitCode),
    },
    loadmillRun: null,
    reportFile: reportExists ? "report.html" : null,
    logFile: "runner.log",
  };
}
