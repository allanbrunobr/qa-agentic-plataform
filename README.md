# Agentic Platform

`agentic-platform` installs a host-local `.agentic-qa` runtime inside a target repository, discovers the host surfaces, and runs agentic QA flows against the target application without modifying the host application code.

This repository is the reproducible baseline validated end-to-end against the Reference Store frontend. The validated dashboard/runtime template now lives inside this repository at `templates/persona-qa-dashboard`.

## Baseline Status

Stable baseline validated on `2026-04-16`:

- install `.agentic-qa` into a real host repository
- run discovery and materialize the adapter locally
- generate `.env.local` from a validated or configured Anthropic key source
- start the generated dashboard and API in isolated ports
- start real multi-role runs from the generated dashboard/runtime
- persist and list sessions correctly in the generated runtime
- run L4 adaptive history, recovery, adaptation, and learning endpoints
- run controlled L5 backend loops for coverage gaps, scenario drafts, profile tuning, schedule recommendations, learning proposals, and bounded self-healing

Validated targets:

- clean temporary host copy under `/tmp`
- real Reference Store frontend repository, with the generated `.agentic-qa` kept isolated from the working application

## What The Platform Does

The platform currently supports a web-frontend-oriented runtime:

1. install a host-local `.agentic-qa`
2. discover host surfaces, roles, routes, and scenarios
3. materialize generated files under `adapter/`
4. copy host operational knowledge into `adapter/runtime/host-source-snapshot/`
5. start a local dashboard runtime
6. execute browser-driven flows with Playwright against the configured target frontend

The generated `.agentic-qa` is isolated from the host runtime itself. It orchestrates runs and observations, while the actual product under test remains the host frontend pointed to by `PLAYWRIGHT_BASE_URL`.

The installer uses `templates/persona-qa-dashboard` by default. For local experiments, override the template with:

```bash
AGENTIC_QA_TEMPLATE_ROOT=/absolute/path/to/persona-qa-dashboard
```

## Current Inputs Expected

At the moment, the platform expects these inputs from the operator:

- target repository path
- Anthropic API key from one of the supported sources
- target frontend base URL through `PLAYWRIGHT_BASE_URL` when running web flows
- application credentials for the host under test when the adapter cannot infer them from existing host runtime knowledge

Anthropic key resolution order:

1. `ANTHROPIC_API_KEY_OVERRIDE`
2. `agentic-platform/.env.local`
3. `ANTHROPIC_API_KEY`
4. `ANTHROPIC_API`
5. target `.agentic-qa/.env.local`

Use `.env.example` as the local shape. `.env.local` is intentionally ignored by git.

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
- `templates/persona-qa-dashboard/`
  - validated host-local `.agentic-qa` dashboard/runtime template
- `adapters/reference-store/`
  - reference adapter assets

## Key Behaviors In This Baseline

- generated package patches native SQLite usage for local installation stability
- generated package installs Playwright and required browser support automatically
- generated package writes `.env.example`
- generated package writes `.env.local` when a key source is available, and can validate it when network access is available
- strict model credential validation is opt-in through `STRICT_ANTHROPIC_VALIDATION=1`
- generated runtime now uses the same session store for run creation and session listing
- generated launcher accepts isolated API and web ports
- L5 changes are controlled: generated scenarios stay as drafts, profile changes are recommendations, and self-healing is bounded and logged

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

## Regression Verification

Run the full clean-room Reference Store install regression:

```bash
cd '/path/to/projects/agentic-platform'
npm run verify:install-local:reference-store
```

The verifier creates a temporary copy of the host repository, installs `.agentic-qa`, runs discovery, installs dependencies, starts the local dashboard/API, executes a real scenario, and validates L4/L5 endpoints.

A passing run prints:

```text
[verify-install-local] PASS tmp=...
[verify-install-local] PASS dashboard=http://localhost:<port>
[verify-install-local] PASS session=...
```

Run the release gate before merging installer, template, runtime, or dashboard changes:

```bash
cd '/path/to/projects/agentic-platform'
npm run verify:release
```

The release gate runs syntax validation for the clean-room verifier, the API L4/L5 release Vitest set, the web release Vitest set, the web production build, and the full clean-room install/runtime/dashboard smoke. Override `API_PORT`, `WEB_PORT`, or `RELEASE_PORT_SEED` if local ports are busy.

## Guardrail

This baseline must continue to work for the Reference Store frontend flow before broader generalization is attempted.

Do not generalize the platform to backend/API/CLI targets until this regression remains green after changes to installer, template, runtime, or dashboard behavior.
