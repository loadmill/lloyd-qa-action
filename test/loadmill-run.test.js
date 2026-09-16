import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {resolveLoadmillDroidRun} from "../src/loadmill-run.js";

const savedId = "c87ec69f-d3cd-44f1-9f80-49dd87a9bb53";

test("reads the exact saved run and screenshot from Droid metadata", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-loadmill-run-"));
  const metadataPath = path.join(directory, "report.json");
  await fs.writeFile(metadataPath, JSON.stringify({
    runId: savedId,
    lastScreenshotObjectName: "screenshots/0016.png",
  }));
  try {
    assert.deepEqual(await resolveLoadmillDroidRun({
      metadataPath,
      baseUrl: "https://local.example/llm/v1",
    }), {
      loadmillRun: {
        id: savedId,
        url: `https://local.example/app/api-tests/droid-runs/${savedId}`,
      },
      screenshot: {
        runId: savedId,
        objectName: "screenshots/0016.png",
      },
    });
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test("rejects invalid structured metadata instead of searching recent runs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-loadmill-run-invalid-"));
  const metadataPath = path.join(directory, "report.json");
  await fs.writeFile(metadataPath, JSON.stringify({
    runId: "not-a-uuid",
    lastScreenshotObjectName: "../secret.png",
  }));
  try {
    assert.equal(await resolveLoadmillDroidRun({metadataPath}), null);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
