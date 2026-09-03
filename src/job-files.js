import fs from "node:fs/promises";
import path from "node:path";
import {RESULT_FILE} from "./contract.js";

export const STATE_FILE = "state.json";

export async function writeJson(directory, fileName, value) {
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(
    path.join(directory, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    {mode: 0o600},
  );
}

export async function readJson(directory, fileName) {
  return JSON.parse(await fs.readFile(path.join(directory, fileName), "utf8"));
}

export async function readResult(directory) {
  return readJson(directory, RESULT_FILE);
}

export async function writeResult(directory, result) {
  return writeJson(directory, RESULT_FILE, result);
}
