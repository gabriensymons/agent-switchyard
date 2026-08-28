---
schemaVersion: 1
id: stable-task
name: not-allowed
title: Add a focused regression test
repository: fixture-repo
providerIdentity: codex-isolated
allowedPaths:
  - src/example.ts
verification:
  - test-targeted
acceptanceCriteria:
  - The regression test passes.
---

Implement only the stated regression fix.
