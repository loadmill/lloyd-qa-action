import {createHash} from "node:crypto";

export const DEFAULT_LOADMILL_BASE_URL = "https://app.loadmill.com";
export const DROID_CUA_PACKAGE = "@loadmill/droid-cua@2.36.0";
export const RESULT_FILE = "result.json";

export function requiredValue(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required value: ${name}`);
  }
  return value.trim();
}

export function loadmillBaseUrl(value) {
  const parsed = new URL((value || DEFAULT_LOADMILL_BASE_URL).trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("LOADMILL_BASE_URL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("LOADMILL_BASE_URL must not contain credentials, a query, or a fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function callbackUrl({baseUrl, jobId, endpoint}) {
  return `${loadmillBaseUrl(baseUrl)}/api/lloyd/jobs/${encodeURIComponent(jobId)}/${endpoint}`;
}

export function artifactNameForJob(jobId) {
  const digest = createHash("sha256").update(jobId).digest("hex").slice(0, 20);
  return `lloyd-results-${digest}`;
}

export function githubContext(environment) {
  return {
    runId: requiredValue(environment, "GITHUB_RUN_ID"),
    runAttempt: requiredValue(environment, "GITHUB_RUN_ATTEMPT"),
  };
}

export function setOutput(name, value, environment = process.env) {
  if (!environment.GITHUB_OUTPUT) {
    return;
  }
  return import("node:fs/promises").then(({appendFile}) =>
    appendFile(environment.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8"),
  );
}
