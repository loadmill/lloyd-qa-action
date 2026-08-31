import {artifactNameForJob, requiredValue, setOutput} from "./contract.js";
import {reportProgress} from "./callbacks.js";
import {STATE_FILE, writeJson} from "./job-files.js";

export async function initialize(environment = process.env, fetchImpl = fetch) {
  const jobId = requiredValue(environment, "LLOYD_JOB_ID");
  const testPath = requiredValue(environment, "LLOYD_TEST_PATH");
  const resultsDirectory = requiredValue(environment, "LLOYD_RESULTS_DIR");
  const startedAt = Date.now();
  const artifactName = artifactNameForJob(jobId);
  await writeJson(resultsDirectory, STATE_FILE, {startedAt, artifactName});
  await setOutput("artifact_name", artifactName, environment);
  await reportProgress({
    stage: "downloading_apk",
    startedAt,
    testPath,
    environment,
    fetchImpl,
  });
  return {startedAt, artifactName};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initialize().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
