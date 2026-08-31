import {postCallback} from "./callbacks.js";
import {artifactNameForJob, requiredValue, setOutput} from "./contract.js";
import {readJson, readResult, STATE_FILE} from "./job-files.js";
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
    return failureResult({
      testPath: environment.LLOYD_TEST_PATH || "",
      startedAt: state.startedAt,
      cancelled,
      detail: cancelled
        ? "The GitHub Actions job was cancelled"
        : "The Action stopped before Droid CUA produced a result",
    });
  }
}

function accountForStepFailures(result, environment) {
  if (environment.LLOYD_UPLOAD_OUTCOME !== "success") {
    return asInfrastructureFailure(
      result,
      `GitHub Actions results artifact upload ${environment.LLOYD_UPLOAD_OUTCOME}`,
    );
  }
  if (environment.LLOYD_RUN_OUTCOME === "failure") {
    return asInfrastructureFailure(result, "The Droid runner step failed unexpectedly");
  }
  if (environment.LLOYD_INITIALIZE_OUTCOME === "failure") {
    return asInfrastructureFailure(result, "The Lloyd initialization step failed");
  }
  return result;
}

export async function complete(environment = process.env, fetchImpl = fetch) {
  const jobId = requiredValue(environment, "LLOYD_JOB_ID");
  const artifactName =
    environment.LLOYD_RESULTS_ARTIFACT_NAME || artifactNameForJob(jobId);
  const result = accountForStepFailures(
    await resultOrFallback(environment),
    environment,
  );

  await postCallback({
    endpoint: "complete",
    payload: completionPayload({result, artifactName, environment}),
    environment,
    fetchImpl,
  });
  await setOutput("status", result.status, environment);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  complete()
    .then((result) => {
      console.log(`Lloyd job completed with status: ${result.status}`);
      if (result.status !== "passed") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`Could not report Lloyd completion: ${error.message}`);
      process.exitCode = 1;
    });
}
