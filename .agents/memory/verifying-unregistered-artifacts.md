---
name: Verifying unregistered artifacts
description: How to take verification screenshots when an artifact isn't in listArtifacts() (e.g. GitHub re-import gap).
---

The `Screenshot` tool's `appPreview` source requires `artifactDirName` to resolve via the platform's artifact registry (`listArtifacts()`). If a project's artifacts aren't registered (see re-import gap), `appPreview` fails with "Artifact not found."

**Why:** The registry is separate from workflow config and repo contents — it's session/environment state that a re-imported project simply doesn't have populated.

**How to apply:** Fall back to `Screenshot` with `source.type: "externalUrl"` pointed at `https://${REPLIT_DEV_DOMAIN}<path>` (read `REPLIT_DEV_DOMAIN` via a `"use impure"` CodeExecution call). This works for verifying that pages render and match designs, but `externalUrl` does not support `viewportSize` — you cannot get a true narrow mobile-width screenshot this way. If pixel-accurate mobile-viewport verification is required, that's a gap to flag to the user rather than something to fake.
