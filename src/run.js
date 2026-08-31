import fs from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {reportProgress} from "./callbacks.js";
import {DROID_CUA_PACKAGE, requiredValue} from "./contract.js";
import {runDroid} from "./droid-runner.js";
import {readJson, STATE_FILE, writeResult} from "./job-files.js";
import {findSingleApk, resolveRepositoryFile} from "./paths.js";
import {failureResult} from "./results.js";

const execFileAsync = promisify(execFile);

async function verifyCheckout(workspace, sha) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error("pr_sha must be a full 40-character Git commit SHA");
  }
  const {stdout} = await execFileAsync("git", ["rev-parse", "HEAD"], {cwd: workspace});
  if (stdout.trim().toLowerCase() !== sha.toLowerCase()) {
    throw new Error(`Checked-out SHA does not match pr_sha (expected ${sha})`);
  }
}

export async function run(environment = process.env, dependencies = {}) {
  const resultsDirectory = requiredValue(environment, "LLOYD_RESULTS_DIR");
  const repositoryTestPath = requiredValue(environment, "LLOYD_TEST_PATH");
  let startedAt = Date.now();
  try {
    ({startedAt} = await readJson(resultsDirectory, STATE_FILE));
  } catch {
    // The completion fallback still receives a useful duration if initialization was interrupted.
  }

  let result;
  try {
    const workspace = requiredValue(environment, "GITHUB_WORKSPACE");
    await verifyCheckout(workspace, requiredValue(environment, "LLOYD_PR_SHA"));
    const testPath = await resolveRepositoryFile({
      workspace,
      repositoryPath: repositoryTestPath,
      label: "test_path",
    });
    if (path.extname(testPath).toLowerCase() !== ".dcua") {
      throw new Error("test_path must identify a .dcua file");
    }
    const contextInput = environment.LLOYD_CONTEXT_PATH?.trim();
    const contextPath = contextInput
      ? await resolveRepositoryFile({
          workspace,
          repositoryPath: contextInput,
          label: "context_path",
        })
      : null;
    const apkPath = await findSingleApk(requiredValue(environment, "LLOYD_APK_DIR"));
    requiredValue(environment, "LOADMILL_API_TOKEN");

    await reportProgress({
      stage: "preparing_test",
      startedAt,
      testPath: repositoryTestPath,
      environment,
      fetchImpl: dependencies.fetchImpl,
    });
    console.log(`Running ${DROID_CUA_PACKAGE}`);
    result = await (dependencies.runDroid ?? runDroid)({
      executable: requiredValue(environment, "LLOYD_DROID_EXECUTABLE"),
      apkPath,
      testPath,
      repositoryTestPath,
      contextPath,
      workspace,
      outputDirectory: resultsDirectory,
      startedAt,
      environment,
      fetchImpl: dependencies.fetchImpl,
      spawnProcess: dependencies.spawnProcess,
    });
  } catch (error) {
    console.error(`Lloyd runner failed: ${error.message}`);
    result = failureResult({
      testPath: repositoryTestPath,
      startedAt,
      detail: error.message,
    });
  }
  await writeResult(resultsDirectory, result);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
