import fs from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {reportProgress} from "./callbacks.js";
import {DROID_CUA_PACKAGE, requiredValue} from "./contract.js";
import {runDroid} from "./droid-runner.js";
import {readJson, STATE_FILE, writeResult} from "./job-files.js";
import {findSingleApk, resolveRepositoryFile} from "./paths.js";
import {failureResult} from "./results.js";
import {parseTestPaths} from "./test-paths.js";

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
  let repositoryTestPaths = [];
  let startedAt = Date.now();
  try {
    ({startedAt} = await readJson(resultsDirectory, STATE_FILE));
  } catch {
    // The completion fallback still receives a useful duration if initialization was interrupted.
  }

  let result;
  try {
    repositoryTestPaths = parseTestPaths(requiredValue(environment, "LLOYD_TEST_PATHS"));
    const workspace = requiredValue(environment, "GITHUB_WORKSPACE");
    await verifyCheckout(workspace, requiredValue(environment, "LLOYD_PR_SHA"));
    const testPaths = await Promise.all(repositoryTestPaths.map((repositoryPath) =>
      resolveRepositoryFile({workspace, repositoryPath, label: "test_paths"})));
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

    await Promise.all(repositoryTestPaths.map((testPath) => reportProgress({
      stage: "preparing_test", startedAt, testPath, environment,
      fetchImpl: dependencies.fetchImpl,
    })));
    console.log(`Running ${DROID_CUA_PACKAGE}`);
    result = await (dependencies.runDroid ?? runDroid)({
      executable: requiredValue(environment, "LLOYD_DROID_EXECUTABLE"),
      apkPath,
      testPaths,
      repositoryTestPaths,
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
    const fallbackPaths = repositoryTestPaths.length ? repositoryTestPaths : [""];
    result = {
      status: "infrastructure_failed",
      results: fallbackPaths.map((testPath) => failureResult({
        testPath, startedAt, detail: error.message,
      })),
    };
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
