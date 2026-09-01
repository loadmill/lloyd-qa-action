import {postCallback} from "./callbacks.js";
import {artifactNameForJob, requiredValue, setOutput} from "./contract.js";
import {readJson, readResult, STATE_FILE} from "./job-files.js";
import {parseTestPaths} from "./test-paths.js";
import {
  asInfrastructureFailure,
  completionPayload,
  failureResult,
} from "./results.js";

async function resultOrFallback(environment) {
  const directory = requiredValue(environment, "LLOYD_RESULTS_DIR");
  try {
    return await readResult(directory);
  } catch {
    const state = await readJson(directory, STATE_FILE).catch(() => ({startedAt: Date.now()}));
    const cancelled = environment.LLOYD_JOB_STATUS === "cancelled";
    let testPaths = [""];
    try {
      testPaths = parseTestPaths(environment.LLOYD_TEST_PATHS || "");
    } catch {}
    const detail = cancelled
      ? "The GitHub Actions job was cancelled"
      : "The Action stopped before Droid CUA produced a result";
    const results = testPaths.map((testPath) => failureResult({
      testPath, startedAt: state.startedAt, cancelled, detail,
    }));
    return {status: cancelled ? "cancelled" : "infrastructure_failed", results};
  }
}

function accountForStepFailures(batch, environment) {
  let detail = null;
  if (environment.LLOYD_UPLOAD_OUTCOME !== "success") {
    detail = `GitHub Actions results artifact upload ${environment.LLOYD_UPLOAD_OUTCOME}`;
  }
  if (!detail && environment.LLOYD_RUN_OUTCOME === "failure") {
    detail = "The Droid runner step failed unexpectedly";
  }
  if (!detail && environment.LLOYD_INITIALIZE_OUTCOME === "failure") {
    detail = "The Lloyd initialization step failed";
  }
  if (!detail) return batch;
  return {
    status: "infrastructure_failed",
    results: batch.results.map((result) => asInfrastructureFailure(result, detail)),
  };
}

export async function complete(environment = process.env, fetchImpl = fetch) {
  const jobId = requiredValue(environment, "LLOYD_JOB_ID");
  const artifactName =
    environment.LLOYD_RESULTS_ARTIFACT_NAME || artifactNameForJob(jobId);
  const batch = accountForStepFailures(
    await resultOrFallback(environment),
    environment,
  );

  const failures = [];
  for (const result of batch.results) {
    try {
      await postCallback({
        endpoint: "complete",
        payload: completionPayload({result, artifactName, environment}),
        environment,
        fetchImpl,
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw failures[0];
  await setOutput("status", batch.status, environment);
  return batch;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  complete()
    .then((batch) => {
      console.log(`Lloyd job completed with status: ${batch.status}`);
      if (batch.status !== "passed") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`Could not report Lloyd completion: ${error.message}`);
      process.exitCode = 1;
    });
}
