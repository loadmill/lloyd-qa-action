import {githubContext} from "./contract.js";

export function failureResult({testPath, startedAt, detail, cancelled = false}) {
  return {
    status: cancelled ? "cancelled" : "infrastructure_failed",
    detail,
    durationSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    exitCode: cancelled ? 130 : null,
    test: {
      path: testPath,
      totalInstructions: 0,
      completedInstructions: 0,
      currentInstruction: null,
    },
    loadmillRun: null,
    reportFile: null,
    logFile: null,
  };
}

export function asInfrastructureFailure(result, detail) {
  return {...result, status: "infrastructure_failed", detail};
}

export function completionPayload({result, artifactName, environment}) {
  return {
    version: 1,
    status: result.status,
    detail: result.detail ?? null,
    durationSeconds: result.durationSeconds,
    exitCode: result.exitCode ?? null,
    test: result.test,
    loadmillRun: result.loadmillRun ?? null,
    artifacts: {
      name: artifactName,
      reportFile: result.reportFile ?? null,
      logFile: result.logFile ?? null,
    },
    github: githubContext(environment),
  };
}
