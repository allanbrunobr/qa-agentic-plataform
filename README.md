# Agentic Platform

`agentic-platform` installs and materializes a local `.agentic-qa` package inside a target repository, then uses that package to run agentic QA flows against the target application.

This repository is the implementation baseline that was validated end-to-end against the real Reference Store frontend repository without changing the existing Reference Store application code.

## Baseline Status

Stable baseline validated on `2026-04-15` / `2026-04-16`:

- install `.agentic-qa` into a real host repository
- run discovery and materialize the adapter locally
- generate `.env.local` automatically when the Anthropic key validates
- start the generated dashboard and API in isolated ports
- start real multi-role runs from the generated dashboard/runtime
- persist and list sessions correctly in the generated runtime

Validated targets:

- clean temporary host copy under `/tmp`
- real Reference Store frontend repository under:
  - `/path/to/projects/reference-store/reference-store-frontend`

## What The Platform Does

The platform currently supports a web-frontend-oriented runtime:

1. install a host-local `.agentic-qa`
2. discover host surfaces, roles, routes, and scenarios
3. materialize generated files under `adapter/`
4. copy host operational knowledge into `adapter/runtime/host-source-snapshot/`
5. start a local dashboard runtime
6. execute browser-driven flows with Playwright against the configured target frontend

The generated `.agentic-qa` is isolated from the host runtime itself. It orchestrates runs and observations, while the actual product under test remains the host frontend pointed to by `PLAYWRIGHT_BASE_URL`.

## Current Inputs Expected

At the moment, the platform expects these inputs from the operator:

- target repository path
- `ANTHROPIC_API_KEY`
- target frontend base URL through `PLAYWRIGHT_BASE_URL` when running web flows
- application credentials for the host under test when the adapter cannot infer them from existing host runtime knowledge

## Current Scope

The validated baseline is for repositories that expose a testable web frontend.

That means:

- Playwright-based execution
- browser navigation and selectors
- UI-driven capabilities
- route and screen discovery

Generalization to backend-only, API-only, CLI-only, or other runtime types is a later step and is not part of this baseline.

## Repository Layout

- `docs/`
  - architecture notes, plans, and implementation references
- `packages/dashboard-api/`
  - install-local, discover-local, local package generation, runtime bootstrap
- `packages/dashboard-web/`
  - UI for setup, review, sessions, and runs
- `packages/core/`
  - shared runtime pieces
- `packages/host-sdk/`
  - host adapter contracts
- `adapters/reference-store/`
  - reference adapter assets

## Key Behaviors In This Baseline

- generated package avoids fragile native SQLite bootstrap by using a local shim strategy
- generated package installs Playwright and required browser support automatically
- generated package writes `.env.example`
- generated package writes `.env.local` only when the Anthropic key validates
- invalid model credentials fail before scenario execution instead of contaminating scenario quality gates
- generated runtime now uses the same session store for run creation and session listing
- generated launcher accepts isolated API and web ports

## Local Development

`agentic-platform` local ports:

- API: `http://localhost:3101`
- Web: `http://localhost:4177`

Run locally:

```bash
cd '/path/to/projects/agentic-platform'
npm run dev:api
npm run dev:web
```

## Example Flow

Install into a target repository:

```bash
node --import "$HOME/.nvm/versions/node/v22.13.1/lib/node_modules/tsx/dist/loader.mjs" \
  packages/dashboard-api/src/cli.ts install-local <repoPath>
```

Run discovery:

```bash
node --import "$HOME/.nvm/versions/node/v22.13.1/lib/node_modules/tsx/dist/loader.mjs" \
  packages/dashboard-api/src/cli.ts discover-local <repoPath>
```

Start the generated package:

```bash
cd <repoPath>/.agentic-qa
./scripts/start-local-dashboard.generated.sh --api-port 3208 --web-port 5184
```

## Guardrail

This baseline must continue to work for the Reference Store frontend flow before broader generalization is attempted.
