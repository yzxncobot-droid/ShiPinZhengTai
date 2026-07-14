---
name: Re-import artifact workflow gap
description: What to do when a GitHub-imported pnpm-workspace project has artifact.toml files on disk but listArtifacts()/workflows are empty.
---

When a project is re-imported from GitHub (not created fresh via `createArtifact`), the `.replit-artifact/artifact.toml` files and source code for each artifact are preserved, but the platform's artifact registry (`listArtifacts()`) and workflow config start empty — `WorkflowsRestart` on the expected `artifacts/<slug>: <service>` name fails with "doesn't exist", and `createArtifact` fails with `ARTIFACT_DIR_EXISTS` since the directory is already there.

**Why:** There is no documented "adopt existing artifact directory" callback. The registry is session/environment state, not derived from the repo contents.

**How to apply:** Read each artifact's `.replit-artifact/artifact.toml` for its dev command, port, and required env vars (`PORT`, `BASE_PATH`, etc. — Vite configs in this kind of project throw if these aren't set). Then use `configureWorkflow` directly (setting env vars inline in the command, e.g. `PORT=8080 pnpm --filter @workspace/api-server run dev`) to stand the services back up manually. This is a deliberate exception to the usual "don't configureWorkflow an artifact service" rule, which assumes the artifact is already registered.
