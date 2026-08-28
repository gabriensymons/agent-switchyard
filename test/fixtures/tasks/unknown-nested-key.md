---
schemaVersion: 1
title: Add a focused regression test
repository: fixture-repo
providerIdentity: codex-isolated
allowedPaths: [src/example.ts]
verification: [test-targeted]
limits:
  runtimeMinutes: 15
  extra: 1
acceptanceCriteria: [The regression test passes.]
---

Implement the fix.
