# Lloyd QA Action

`loadmill/lloyd-qa-action` runs Lloyd-selected [Droid CUA](https://www.npmjs.com/package/@loadmill/droid-cua) tests against an Android APK and reports structured progress and results to Loadmill.

The Action is deliberately a thin wrapper. It installs the pinned `@loadmill/droid-cua@2.36.0` package in the runner's temporary directory before checking out PR code, then invokes its existing `run` command and normal CLI flags. Lloyd-specific job state remains inside this Action; Droid CUA has no Lloyd-specific flag or behavior.

## Requirements

- A Linux GitHub-hosted runner (the example uses `ubuntu-latest`).
- A workflow triggered with the seven Lloyd dispatch inputs shown below.
- `contents: read` and `actions: read` workflow permissions.
- A repository secret named `LOADMILL_API_TOKEN`.
- An APK artifact produced by a workflow run in the same repository. The selected artifact must contain exactly one `.apk` file.
- The selected `.dcua` test and optional context file must exist at the exact PR commit.

Forked pull requests are outside the Lloyd MVP v1 contract.

## Usage

Create `.github/workflows/lloyd-droid.yml` on the repository's default branch. See the complete [customer workflow example](examples/lloyd-droid.yml).

```yaml
name: Lloyd Droid test

on:
  workflow_dispatch:
    inputs:
      job_id: {required: true, type: string}
      pr_number: {required: true, type: string}
      pr_sha: {required: true, type: string}
      test_paths: {required: true, type: string}
      context_path: {required: false, type: string}
      apk_workflow_run_id: {required: true, type: string}
      apk_artifact_name: {required: true, type: string}

permissions:
  contents: read
  actions: read

jobs:
  droid:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: loadmill/lloyd-qa-action@v1
        with:
          job_id: ${{ inputs.job_id }}
          pr_number: ${{ inputs.pr_number }}
          pr_sha: ${{ inputs.pr_sha }}
          test_paths: ${{ inputs.test_paths }}
          context_path: ${{ inputs.context_path }}
          apk_workflow_run_id: ${{ inputs.apk_workflow_run_id }}
          apk_artifact_name: ${{ inputs.apk_artifact_name }}
        env:
          LOADMILL_API_TOKEN: ${{ secrets.LOADMILL_API_TOKEN }}
```

Do not pass `LOADMILL_API_TOKEN` through a workflow input. GitHub masks repository secrets and does not expose this secret to the coordinator's dispatch payload.

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `job_id` | Yes | Opaque Lloyd job identifier used only for callbacks and deterministic artifact naming. |
| `pr_number` | Yes | Positive pull request number. |
| `pr_sha` | Yes | Full 40-character commit SHA. The Action checks out and verifies this exact commit. |
| `test_paths` | Yes | JSON array of repository-relative `.dcua` test paths, in execution order. |
| `context_path` | No | Repository-relative path to a Droid context file. |
| `apk_workflow_run_id` | Yes | GitHub Actions workflow run containing the APK artifact. |
| `apk_artifact_name` | Yes | Exact artifact name in that workflow run. |

The list must be non-empty and contain no duplicates. Absolute paths, traversal outside the checkout, symlink escapes, missing files, non-`.dcua` files, and artifacts containing zero or multiple APKs are rejected.

## Execution

The Action invokes Droid CUA without a shell and passes each CLI argument separately. The fixed execution configuration is:

- Provider: Loadmill
- CUA model: `loadmill-pulse`
- Device source: Loadmill Cloud
- Device: Google Pixel 8
- OS: Android 14
- Droid timeout: 40 minutes
- Video artifacts, HTML report, and debug logging enabled

The working directory is the checked-out repository root. Droid runs the selected paths sequentially in one cloud-device session. Droid's `logs` and `droid-cua-artifacts` directories, individual and aggregate HTML reports, and the combined runner log are collected when present.

## Loadmill callbacks

The Action authenticates callbacks with `Authorization: Bearer <LOADMILL_API_TOKEN>`. It uses `https://app.loadmill.com` by default. Loadmill staging workflows may set `LOADMILL_BASE_URL` as an environment variable; it is intentionally not an Action input.

Progress callback failures are warnings and do not interrupt the tests. The Action sends one completion callback per selected path using the same Lloyd job ID. For multiple selected tests, every callback references Droid's single combined Loadmill report. It attempts every completion delivery; any delivery failure fails the Action.

Progress stages are:

```text
downloading_apk
preparing_test
provisioning
connected
running_instruction
collecting_results
```

Final statuses are:

```text
passed
test_failed
infrastructure_failed
cancelled
```

The Action succeeds only when every selected test passes. Test, infrastructure, cancellation, results-upload, and completion-delivery failures return a failing Action status.

## Results artifact and outputs

The results artifact is named deterministically as `lloyd-results-` followed by the first 20 hexadecimal characters of the SHA-256 digest of `job_id`. It is retained for 14 days.

Outputs:

| Output | Description |
| --- | --- |
| `status` | Final Lloyd status when completion delivery succeeds. |
| `results_artifact_name` | Deterministic GitHub Actions artifact name. |

## Development

```sh
npm test
```

Do not loosen the exact Droid CUA dependency version without coordinating the Lloyd contract and validating the CLI output used for progress parsing.
