import fs from "node:fs/promises";

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

export async function resolveLoadmillDroidRun({
  metadataPath,
  baseUrl,
}) {
  const payload = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  if (!isUuid(payload?.runId)) return null;
  const objectName = payload?.lastScreenshotObjectName;
  const screenshot = /^screenshots\/\d{4}\.png$/.test(objectName)
    ? {runId: payload.runId, objectName}
    : null;

  return {
    loadmillRun: {
      id: payload.runId,
      url: `${siteUrl(baseUrl)}/app/api-tests/droid-runs/${encodeURIComponent(payload.runId)}`,
    },
    screenshot,
  };
}
