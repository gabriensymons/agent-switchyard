# Agent Switchyard

A local-first, quota-aware scheduler for subscription-backed coding agents.

> [!IMPORTANT]
> This repository is an early feasibility spike. It does not yet dispatch implementation tasks or run unattended.

Agent Switchyard launches official coding-agent CLIs that the operator has installed and authenticated independently. It will coordinate isolated Git worktrees, durable handoffs, provider usage windows, and work that can safely continue while the operator is away.

## M0: provider feasibility

The first milestone proves that local provider installations can be detected without reading or exporting credentials. The `doctor` command currently checks:

- Git availability, repository root, branch, and cleanliness.
- Codex version, redacted machine-readable health, authentication readiness, and reachability.
- Claude Code version and machine-readable authentication readiness when installed.
- Whether machine-readable usage telemetry is actually available.

Unknown usage is intentional. Switchyard will not infer a percentage from undocumented files, scrape browser sessions, or claim that a provider is below a quota threshold without evidence.

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
```

## Safety boundary

`switchyard doctor` only runs provider version, health, and authentication-status commands. The separately acknowledged `probe --live` experiment sends one fixed prompt using an ephemeral, read-only session against a disposable fixture. M0 does not run implementation prompts, modify target repositories, read credential files, publish packages, push branches, or create pull requests.

See [the M0 feasibility notes](docs/m0-feasibility-spike.md), [security policy](SECURITY.md), and [architecture decisions](docs/adr/).

## License

Apache-2.0.
