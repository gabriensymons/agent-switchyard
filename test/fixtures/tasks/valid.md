---
schemaVersion: 1
id: stable-task
title: Add a focused regression test
repository: fixture-repo
providerIdentity: codex-isolated
allowedPaths:
  - src/example.ts
  - test/example.test.ts
verification:
  - test-targeted
limits:
  runtimeMinutes: 15
  attempts: 1
  changedFiles: 4
  diffLines: 300
  changedFileBytes: 131072
  commandOutputBytes: 524288
acceptanceCriteria:
  - The regression test fails before the fix and passes after it.
---

Implement only the stated regression fix.
