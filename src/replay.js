import fs from "node:fs/promises";
import path from "node:path";
import {postCallback} from "./callbacks.js";
import {requiredValue} from "./contract.js";
import {readResult} from "./job-files.js";

const SESSION_PATTERN = /^mtc_[0-9a-f-]{36}$/i;
const VIDEO_PATTERN = /^video(?:-\d+)?\.(?:mp4|mov|webm)$/i;
const RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 1_000;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    if (names.length > 0) sessions.push({sessionId: entry.name});
  }
  return sessions;
}

export async function registerReplay(environment = process.env, fetchImpl = fetch, waitImpl = wait) {
  const outputDirectory = requiredValue(environment, "LLOYD_RESULTS_DIR");
  const batch = await readResult(outputDirectory);
  const droidRunIds = [...new Set(batch.results
    .map((result) => result.loadmillRun?.id)
    .filter(Boolean))];
  const sessions = await discoverReplay(outputDirectory);
  if (droidRunIds.length !== 1 || sessions.length !== 1) {
    console.warn("Warning: could not identify one exact Droid run and cloud session for replay");
    return {registered: false};
  }
  const session = sessions[0];
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      await postCallback({
        endpoint: "replay",
        payload: {
          version: 1,
          droidRunId: droidRunIds[0],
          sessionId: session.sessionId,
        },
        environment,
        fetchImpl,
      });
      console.log("Registered session replay");
      return {registered: true};
    } catch (error) {
      if (error.status !== 409 || attempt === RETRY_ATTEMPTS) throw error;
      console.log(`Replay registration is not ready; retrying (${attempt}/${RETRY_ATTEMPTS})`);
      await waitImpl(RETRY_DELAY_MS);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  registerReplay().catch((error) => {
    console.warn(`Warning: could not register session replay: ${error.message}`);
    process.exitCode = 1;
  });
}
