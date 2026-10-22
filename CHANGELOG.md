# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions can
contain breaking changes.

## [0.1.0] - 2026-10-22

First public release (alpha).

### Added

- CLI commands `install-local` and `discover-local`. They install a
  self-contained `.agentic-qa/` runtime (dashboard, API, and launcher) into a
  target repository, and write reviewable discovery output to
  `.agentic-qa/adapter/`.
- Discovery for frontend, backend API, CLI, library, monorepo, and unknown
  repositories. Frontends get personas, capabilities, routes, scenarios, and
  workflow contracts derived from a TypeScript AST code graph.
- Multi-agent runs that drive the target app in a real browser (Playwright),
  with Anthropic or OpenAI models, or with a deterministic runtime that needs no
  API key.
- Deterministic workflow contracts and contract evaluation
  (`contract_compliant`, `contract_drift`, `contract_violated`), quality gates,
  and evidence (events, artifacts, screenshots).
- Governed L4/L5 loops: failure diagnosis, adaptive retries, scenario drafts,
  profile tuning, and bounded self-healing that require approval.
- Runtime dashboard (agentic overview, runs, personas, insights, code graph) and
  an optional platform dashboard.
- Runnable example in `examples/storefront`.
- CI on GitHub Actions: typecheck, unit tests, and an end-to-end check that
  runs the example and expects a deliberately broken copy to fail.
- `npm run demo:capture`, which captures the dashboard screenshots used in
  the README.
- Documentation: architecture, generated files, testing, and ADRs.

### Fixed

- Generic frontend runs fail closed. A missing or disabled control fails the
  step, and the final assertion needs visible success feedback. Before this
  fix, such runs could be reported as passes.

### Security

- The runtime binds to localhost. `.env.local` is written with `0600`
  permissions and is git-ignored in the installed runtime.

[0.1.0]: https://github.com/allanbrunobr/qa-agentic-platform/releases/tag/v0.1.0
