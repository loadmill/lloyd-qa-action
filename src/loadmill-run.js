const DEFAULT_LOADMILL_SITE_URL = "https://app.loadmill.com";

function siteUrl(baseUrl) {
  const parsed = new URL((baseUrl || DEFAULT_LOADMILL_SITE_URL).trim());
  parsed.pathname = parsed.pathname
    .replace(/\/+$/, "")
    .replace(/\/llm\/v1$/, "")
    .replace(/\/llm$/, "")
    .replace(/\/api$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function completedAtMillis(value) {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregateCandidates(runs, {projectName, testCount, startedAt, endedAt}) {
  return runs.filter((run) => {
    const completedAt = completedAtMillis(run?.completedAt);
    return run?.source === "ci"
      && run?.project === projectName
      && run?.testName === "Selected tests"
      && run?.payload?.runType === "project"
      && run?.payload?.testCases === testCount
      && run?.hasReport === true
      && completedAt !== null
      && completedAt >= startedAt
      && completedAt <= endedAt + 5_000;
  });
}

export async function resolveLoadmillDroidRun({
  token,
  localRunIds,
  projectName,
  testCount,
  startedAt,
  endedAt,
  baseUrl,
  fetchImpl = fetch,
}) {
  if (!token || localRunIds.length === 0) return null;

  const base = siteUrl(baseUrl);
  const response = await fetchImpl(`${base}/api/droid-cua/runs?limit=100`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Loadmill Droid run lookup failed (HTTP ${response.status})`);
  }

  const payload = await response.json();
  const runs = Array.isArray(payload?.runs) ? payload.runs : [];
  const matches = testCount > 1
    ? aggregateCandidates(runs, {projectName, testCount, startedAt, endedAt})
    : runs.filter((run) => localRunIds.includes(run?.runId));
  if (matches.length !== 1 || !isUuid(matches[0].id)) return null;

  return {
    id: matches[0].id,
    url: `${base}/app/api-tests/droid-runs/${encodeURIComponent(matches[0].id)}`,
  };
}
