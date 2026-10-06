import fs from "node:fs/promises";
import path from "node:path";

function formatSecret(key, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string") {
    throw new Error("LLOYD_SECRETS must contain string values keyed by environment variable names");
  }
  const quote = ["`", "'", '"'].find((candidate) =>
    !value.includes(candidate) && (candidate !== '"' || !/\\[nr]/.test(value)));
  if (quote) return `${key}=${quote}${value}${quote}`;
  if (value.trim() === value && !/[#\r\n]/.test(value)) return `${key}=${value}`;
  throw new Error(`LLOYD_SECRETS value for ${key} cannot be represented in Droid's .secrets format`);
}

export async function withDroidSecrets(workspace, rawSecrets, run) {
  if (rawSecrets === undefined || rawSecrets === "") return run();
  const filePath = path.join(workspace, ".secrets");
  const exists = await fs.lstat(filePath).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (exists) return run();

  let secrets;
  try {
    secrets = JSON.parse(rawSecrets);
  } catch {
    throw new Error("LLOYD_SECRETS must be a JSON object");
  }
  if (!secrets || Array.isArray(secrets) || typeof secrets !== "object") {
    throw new Error("LLOYD_SECRETS must be a JSON object");
  }

  const content = Object.entries(secrets).map(([key, value]) => formatSecret(key, value)).join("\n");
  await fs.writeFile(filePath, `${content}\n`, {flag: "wx", mode: 0o600});
  try {
    return await run();
  } finally {
    await fs.rm(filePath);
  }
}
