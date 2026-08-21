# Agent Switchyard

A local-first, quota-aware scheduler for subscription-backed coding agents.

> [!IMPORTANT]
> This repository is an early feasibility spike. It does not yet dispatch implementation tasks or run unattended.

Agent Switchyard launches official coding-agent CLIs that the operator has installed and authenticated independently. It will coordinate isolated Git worktrees, durable handoffs, provider usage windows, and work that can safely continue while the operator is away.

## Why Switchyard?

Maybe you have experienced this: you are deep into a project when your coding agent reaches its usage limit. The work stops, the context is still fresh, and the next reset may be hours away.

Agent Switchyard is intended to let you prepare bounded work in advance and schedule it across the coding agents you already use. When an agent needs to pause, Switchyard should preserve a durable handoff, wait for trustworthy capacity, and continue safely. When you return, a report should tell you:

- What work was completed and how it was verified.
- What stopped, failed, or is waiting for a usage reset.
- Which decisions or questions need your input.
- What Switchyard recommends doing next.

That is the product direction, not the current feature set. M0 establishes the provider, identity, cancellation, recovery, and safety foundations; unattended implementation work remains disabled.

## M0: provider feasibility

The first milestone proves that local provider installations can be detected without reading or exporting credentials. The `doctor` command currently checks:

- Git availability, repository root, branch, and cleanliness.
- Codex version, redacted machine-readable health, authentication readiness, and reachability.
- Claude Code version and machine-readable authentication readiness when installed.
- Whether machine-readable usage telemetry is actually available.

Unknown usage is intentional. Switchyard will not infer a percentage from undocumented files, scrape browser sessions, or claim that a provider is below a quota threshold without evidence.

### Isolated Codex identities

Switchyard exposes two Codex identities:

- `codex-default` uses the existing default Codex home and preserves whichever authentication the operator has selected there; doctor reports the observed mode rather than inferring it from the identity name.
- `codex-isolated` uses `~/.agent-switchyard/codex/isolated` as a separate `CODEX_HOME`, with file-backed credentials. Switchyard removes inherited `OPENAI_API_KEY` and `CODEX_ACCESS_TOKEN` values before invoking this identity so they cannot override its independent ChatGPT login.

Prepare the isolated directory, then authenticate it through the official Codex browser or device-code flow:

```sh
npm run build
node dist/cli.js auth prepare codex-isolated
node dist/cli.js auth login codex-isolated
# Or: node dist/cli.js auth login codex-isolated --device-auth
```

`switchyard doctor` checks both identities without reading their credential files. A live probe can explicitly select one:

```sh
node dist/cli.js probe codex --identity codex-isolated --live --cwd test/fixtures/live-repo
```

The isolated home is local state, not repository content. Never copy its `auth.json` into this repository or include it in logs, issues, handoff documents, or task prompts.

## Development

Requirements:

- Node.js 22 or newer.
- Git.
- Codex and/or Claude Code installed and authenticated separately.

```sh
npm install
npm run check
npm run doctor
npm run doctor -- --json
```

To inspect a different repository:

```sh
npm run doctor -- --cwd /path/to/repository
```

An explicit live protocol experiment is also available. It sends one fixed prompt in read-only, ephemeral mode and returns only the event summary—not the transcript:

```sh
npm run build
node dist/cli.js probe codex --live --cwd test/fixtures/live-repo
node dist/cli.js probe claude --live --cwd test/fixtures/live-repo
```

The lifecycle experiment persists a sanitized run record outside the repository, intentionally cancels the same fixed probe, and writes a private handoff. Restart only proceeds when the recorded path is still a clean Git worktree root, and it creates a fresh linked attempt rather than resuming provider conversation state:

```sh
node dist/cli.js experiment cancel codex --identity codex-isolated --live --cwd /path/to/disposable-clean-worktree
node dist/cli.js experiment restart <run-id> --live
```

Use `--state-root` to isolate lifecycle records for an experiment; it does not relocate the selected provider identity's credential home. Claude uses the explicit `claude-subscription` identity and must already be authenticated through the official CLI.

Claude Code does not expose the client `/usage` percentage as a stable CLI command. Switchyard can instead compute an optional rolling token proxy from local Claude Code transcripts. It reads only timestamps and token-usage fields and emits no transcript text, project names, paths, or session identifiers:

```sh
npm run build
node dist/cli.js usage claude
node dist/cli.js usage claude --calibration '2026-08-20T00:09:00-07:00=43'
```

Without calibration, the report contains weighted activity only. With an operator-supplied client observation, the percentage is labeled `estimated`; it must never be represented as Anthropic's authoritative plan usage.

## Safety boundary

`switchyard doctor` only runs provider version, health, and authentication-status commands. The separately acknowledged `probe --live` experiment sends one fixed prompt using an ephemeral, read-only session against a disposable fixture. The auth setup command creates a private, isolated Codex home and starts the official login flow; it never reads, copies, or prints credentials. M0 does not run implementation prompts, modify target repositories, read credential files, publish packages, push branches, or create pull requests.

See [the public roadmap](ROADMAP.md), [M0 feasibility notes](docs/m0-feasibility-spike.md), [security policy](SECURITY.md), and [architecture decisions](docs/adr/).

## License

Apache-2.0.
