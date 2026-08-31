import fs from "node:fs/promises";
import path from "node:path";

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveRepositoryFile({workspace, repositoryPath, label}) {
  if (typeof repositoryPath !== "string" || repositoryPath.trim() === "") {
    throw new Error(`${label} must be a non-empty repository-relative path`);
  }
  if (path.posix.isAbsolute(repositoryPath) || path.win32.isAbsolute(repositoryPath)) {
    throw new Error(`${label} must be repository-relative: ${repositoryPath}`);
  }
  const root = await fs.realpath(workspace);
  const candidate = path.resolve(root, repositoryPath);
  if (!isInside(root, candidate)) {
    throw new Error(`${label} escapes the repository: ${repositoryPath}`);
  }
  const resolved = await fs.realpath(candidate);
  if (!isInside(root, resolved)) {
    throw new Error(`${label} resolves outside the repository: ${repositoryPath}`);
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file: ${repositoryPath}`);
  }
  return resolved;
}

export async function findSingleApk(apkDirectory) {
  const root = await fs.realpath(apkDirectory);
  const matches = [];

  async function visit(directory) {
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`APK artifact contains a symbolic link: ${path.relative(root, entryPath)}`);
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".apk")) {
        matches.push(entryPath);
      }
    }
  }

  await visit(root);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one APK in the downloaded artifact, found ${matches.length}`);
  }
  return matches[0];
}
