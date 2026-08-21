# Security policy

## Scope

Agent Switchyard is experimental software that may eventually launch coding agents with repository access. M0's doctor is read-only and only probes local command versions, redacted health, and authentication status. Its separately acknowledged live experiment sends one fixed prompt against a disposable fixture using an ephemeral, read-only provider session.

## Credential policy

- Authenticate each provider using its official CLI.
- Never submit credentials to Switchyard or commit them to this repository.
- Switchyard must not read provider credential stores, browser cookies, or raw tokens.
- Fixtures and logs must contain no tokens, private source, full transcripts, or identifying local paths.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or leaked credential. Use GitHub's private security-advisory reporting for this repository. Revoke any exposed credential before reporting it.

## Unattended execution boundary

Future write-capable milestones must default to isolated worktrees and must not merge, force-push, publish, deploy, migrate remote databases, or perform destructive cleanup without a separately reviewed policy.
