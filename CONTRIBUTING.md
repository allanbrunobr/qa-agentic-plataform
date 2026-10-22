# Contributing

Thanks for taking a look. This is a personal, alpha-stage project, so issues and small pull requests work best.

## Setup

Requirements: Node.js 22.13 or later (see `.nvmrc`), npm, macOS or Linux (WSL on Windows).

```bash
npm install
npm run setup:runtime
```

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run test:e2e        # needs Chromium; the launcher installs it on first use
npm run verify:release  # required for changes to the installer, template, runtime, or dashboard
```

CI runs the same commands. See [docs/testing.md](docs/testing.md) for what each layer covers and how to run a single test.

## Guidelines

- Read [AGENTIC.md](AGENTIC.md) for repository conventions (it is written for both people and coding agents).
- Keep generic paths generic: discovery, the materializer, and generic capabilities must not contain host- or domain-specific names. Domain knowledge belongs in an adapter under `adapters/`.
- Never commit secrets, `.env.local` files, or local databases (`*.db`).
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`, `test:`, `ci:`, `chore:`).
