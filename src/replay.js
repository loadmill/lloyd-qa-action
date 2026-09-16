import fs from "node:fs/promises";
import path from "node:path";
import {postCallback} from "./callbacks.js";
import {requiredValue} from "./contract.js";
import {readResult} from "./job-files.js";

const SESSION_PATTERN = /^mtc_[0-9a-f-]{36}$/i;
const VIDEO_PATTERN = /^video(?:-\d+)?\.(?:mp4|mov|webm)$/i;

export async function discoverReplay(outputDirectory) {
  const artifactsDirectory = path.join(outputDirectory, "droid-cua-artifacts");
  const entries = await fs.readdir(artifactsDirectory, {withFileTypes: true}).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SESSION_PATTERN.test(entry.name)) continue;
    const sessionDirectory = path.join(artifactsDirectory, entry.name);
    const names = (await fs.readdir(sessionDirectory))
      .filter((name) => VIDEO_PATTERN.test(name))
      .sort();
    const recordings = await Promise.all(names.map(async (name, index) => {
      const filePath = path.join(sessionDirectory, name);
      const stat = await fs.stat(filePath);
      return {index, size: stat.size};
    }));
    if (recordings.length > 0) sessions.push({sessionId: entry.name, recordings});
  }
  return sessions;
}

export async function registerReplay(environment = process.env, fetchImpl = fetch) {
  const outputDirectory = requiredValue(environment, "LLOYD_RESULTS_DIR");
  const batch = await readResult(outputDirectory);
  const droidRunIds = [...new Set(batch.results
    .map((result) => result.loadmillRun?.id)
    .filter(Boolean))];
  const sessions = await discoverReplay(outputDirectory);
  if (droidRunIds.length !== 1 || sessions.length !== 1 || !batch.results[0]?.test?.path) {
    console.warn("Warning: could not identify one exact Droid run and cloud session for replay");
    return {registered: false};
  }
  const session = sessions[0];
  await postCallback({
    endpoint: "replay",
    payload: {
      version: 1,
      droidRunId: droidRunIds[0],
      sessionId: session.sessionId,
      recordings: session.recordings.map(({index, size}) => ({index, size})),
      testPath: batch.results[0].test.path,
      github: {
        runId: requiredValue(environment, "GITHUB_RUN_ID"),
        runAttempt: requiredValue(environment, "GITHUB_RUN_ATTEMPT"),
      },
    },
    environment,
    fetchImpl,
  });
  console.log(`Registered ${session.recordings.length} session replay recording${session.recordings.length === 1 ? "" : "s"}`);
  return {registered: true};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  registerReplay().catch((error) => {
    console.warn(`Warning: could not register session replay: ${error.message}`);
    process.exitCode = 1;
  });
}
