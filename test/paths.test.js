import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {findSingleApk, resolveRepositoryFile} from "../src/paths.js";

test("accepts a regular repository file and rejects traversal", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-paths-"));
  const workspace = path.join(parent, "workspace");
  await fs.mkdir(path.join(workspace, "tests"), {recursive: true});
  await fs.writeFile(path.join(workspace, "tests", "login.dcua"), "Open app\n");
  await fs.writeFile(path.join(parent, "outside.dcua"), "outside\n");
  try {
    assert.equal(
      await resolveRepositoryFile({
        workspace,
        repositoryPath: "tests/login.dcua",
        label: "test_path",
      }),
      await fs.realpath(path.join(workspace, "tests", "login.dcua")),
    );
    await assert.rejects(
      resolveRepositoryFile({
        workspace,
        repositoryPath: "../outside.dcua",
        label: "test_path",
      }),
      /escapes the repository/,
    );
    await assert.rejects(
      resolveRepositoryFile({
        workspace,
        repositoryPath: path.join(parent, "outside.dcua"),
        label: "test_path",
      }),
      /repository-relative/,
    );
  } finally {
    await fs.rm(parent, {recursive: true, force: true});
  }
});

test("rejects a repository symlink that resolves outside", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-symlink-"));
  const workspace = path.join(parent, "workspace");
  await fs.mkdir(workspace);
  const outside = path.join(parent, "outside.dcua");
  await fs.writeFile(outside, "outside\n");
  await fs.symlink(outside, path.join(workspace, "linked.dcua"));
  try {
    await assert.rejects(
      resolveRepositoryFile({
        workspace,
        repositoryPath: "linked.dcua",
        label: "test_path",
      }),
      /resolves outside the repository/,
    );
  } finally {
    await fs.rm(parent, {recursive: true, force: true});
  }
});

test("requires exactly one non-symlink APK", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lloyd-apk-"));
  try {
    await fs.mkdir(path.join(directory, "nested"));
    await fs.writeFile(path.join(directory, "nested", "app.apk"), "apk");
    assert.equal(
      await findSingleApk(directory),
      await fs.realpath(path.join(directory, "nested", "app.apk")),
    );
    await fs.writeFile(path.join(directory, "second.apk"), "apk");
    await assert.rejects(findSingleApk(directory), /found 2/);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
