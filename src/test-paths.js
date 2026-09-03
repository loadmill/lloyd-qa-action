import path from "node:path";

export function parseTestPaths(value) {
  let paths;
  try {
    paths = JSON.parse(value);
  } catch {
    throw new Error("test_paths must be a JSON array of repository-relative .dcua paths");
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("test_paths must contain at least one path");
  }
  if (paths.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error("test_paths entries must be non-empty strings");
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error("test_paths must not contain duplicate paths");
  }
  if (paths.some((entry) => path.posix.extname(entry).toLowerCase() !== ".dcua")) {
    throw new Error("test_paths entries must identify .dcua files");
  }
  return paths;
}
