import {
  callbackUrl,
  githubContext,
  requiredValue,
} from "./contract.js";

export async function postCallback({
  endpoint,
  payload,
  environment = process.env,
  fetchImpl = fetch,
}) {
  const jobId = requiredValue(environment, "LLOYD_JOB_ID");
  const token = requiredValue(environment, "LOADMILL_API_TOKEN");
  const response = await fetchImpl(
    callbackUrl({
      baseUrl: environment.LOADMILL_BASE_URL,
      jobId,
      endpoint,
    }),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`Loadmill ${endpoint} callback failed (HTTP ${response.status})`);
  }
}

export function progressPayload({
  stage,
  startedAt,
  testPath,
  current = null,
  total = null,
  instruction = null,
  environment = process.env,
}) {
  return {
    version: 1,
    stage,
    elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    test: {
      path: testPath,
      current,
      total,
      instruction,
    },
    github: githubContext(environment),
  };
}

export async function reportProgress(input) {
  const {environment = process.env, fetchImpl = fetch} = input;
  try {
    await postCallback({
      endpoint: "progress",
      payload: progressPayload(input),
      environment,
      fetchImpl,
    });
  } catch (error) {
    console.warn(`Warning: could not publish Lloyd progress: ${error.message}`);
  }
}
