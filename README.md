# Agentic Platform

`agentic-platform` installs a host-local `.agentic-qa` runtime inside a target repository, discovers the host surfaces, and runs agentic QA flows against the target application without modifying the host application code.

This repository is the reproducible baseline for installing and running agentic QA against host repositories. The validated dashboard/runtime template lives inside this repository at `templates/persona-qa-dashboard`.

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

Validated target shapes:

- clean temporary host copy under `/tmp`
- real frontend repository, with the generated `.agentic-qa` kept isolated from the working application
- deterministic generic fixtures for frontend, backend API, CLI, library, and unknown repository shapes

## What The Platform Does

The platform currently supports two layers:

1. install a host-local `.agentic-qa`
2. classify the target repository shape
3. discover host surfaces, roles, routes, and scenarios
4. materialize generated files under `adapter/`
5. copy host operational knowledge into `adapter/runtime/host-source-snapshot/`
6. start a local dashboard runtime
7. execute browser-driven flows with Playwright against the configured target frontend
8. execute deterministic non-browser smoke flows for backend API, CLI, library, monorepo, and unknown repository shapes

Frontend adapters can be promoted to runnable Playwright flows after host credentials, routes, and capabilities are mapped. Backend API, CLI, library, and unknown repository adapters are generated as draft adapters first: AP classifies the repository, creates initial personas/scenarios/capability stubs, and marks browser login as not applicable until runtime-specific execution is mapped.

For non-frontend repositories, the generated dashboard can start without Chromium or Anthropic. Runs use deterministic tools that inspect the repository, execute safe CLI/API probes when explicit runtime configuration exists, and otherwise produce dry-run artifacts that make the missing mapping visible.

The generated `.agentic-qa` is isolated from the host runtime itself. It orchestrates runs and observations, while the actual product under test remains the target pointed to by runtime configuration such as `PLAYWRIGHT_BASE_URL` for web flows.

The installer uses `templates/persona-qa-dashboard` by default. For local experiments, override the template with:

```bash
AGENTIC_QA_TEMPLATE_ROOT=/absolute/path/to/persona-qa-dashboard
```

## Current Inputs Expected

At the moment, the platform expects these inputs from the operator:

- target repository path
- Anthropic API key from one of the supported sources when running browser/model-backed frontend flows
- target frontend base URL through `PLAYWRIGHT_BASE_URL` when running web flows
- API base URL through `GENERIC_API_BASE_URL`, `TARGET_API_BASE_URL`, or `API_BASE_URL` when running real backend API probes
- CLI command through `GENERIC_CLI_COMMAND` or `TARGET_CLI_COMMAND` when the package `bin` entry is not enough
- application credentials for the host under test when the adapter cannot infer them from existing host runtime knowledge

Anthropic key resolution order:

1. `ANTHROPIC_API_KEY_OVERRIDE`
2. `agentic-platform/.env.local`
3. `ANTHROPIC_API_KEY`
4. `ANTHROPIC_API`
5. target `.agentic-qa/.env.local`

Use `.env.example` as the local shape. `.env.local` is intentionally ignored by git.

## Current Scope

The validated runnable baseline is still strongest for repositories that expose a testable web frontend.

For frontend repositories, that means:

- Playwright-based execution
- browser navigation and selectors
- UI-driven capabilities
- route and screen discovery

For backend API, CLI, library, monorepo, and unknown repositories, AP now performs deterministic classification, draft adapter generation, and non-browser smoke execution. These runs prove that the generated personas/scenarios/contracts can execute, but they remain smoke/inspection runs until repository-specific runtime URLs, commands, auth, seed data, and assertions are mapped.

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
- `adapters/`
  - reference adapter assets

## Key Behaviors In This Baseline

- generated package patches native SQLite usage for local installation stability
- generated package installs Playwright and required browser support automatically for frontend/browser runtimes
- generated package skips Playwright and required Anthropic validation for non-frontend deterministic runtimes
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

Run the release gate before merging installer, template, runtime, or dashboard changes:

```bash
cd '/path/to/projects/agentic-platform'
npm run verify:release
```

The release gate runs syntax validation for the verifiers, domain discovery contract validation, static frontend scanner verification, domain fixture matrix verification, domain specialist service verification, the API L4/L5 release Vitest set, the web release Vitest set, the web production build, and a deterministic clean-room install/runtime/dashboard smoke. The smoke uses deterministic workflow tools so it does not depend on live application login or backend state. Override `API_PORT`, `WEB_PORT`, or `RELEASE_PORT_SEED` if local ports are busy.

A passing run prints:

```text
[verify-release] PASS api: L4/L5 release vitest
[verify-release] PASS web: release vitest
[verify-release] PASS web: build
[verify-domain-discovery-contracts] PASS domain discovery contract verification
[verify-static-frontend-scanner] PASS static frontend scanner verification
[verify-domain-fixture-matrix] PASS domain fixture matrix verification
[verify-domain-specialist-service] PASS domain specialist service verification
[verify-generic-repository-types] PASS generic repository type install/discovery verification
[verify-generic-runtime-execution] PASS generic repository deterministic runtime verification
[verify-install-local] PASS tmp=...
[verify-install-local] PASS dashboard=http://localhost:<port>
[verify-install-local] PASS session=...
[verify-release] PASS release verification
```

Run real target integration only when the selected local or remote environment is intentionally available. Real integration should use the same clean-room install path, but with real Playwright workflow tools. It can create or mutate data in the configured target environment, so it must stay separate from `verify:release`.

## Guardrail

This baseline must continue to work for a real frontend host flow while broader repository generalization evolves.

Do not mark backend/API/CLI/library adapters as product-validating until their generated draft capabilities are mapped to real execution commands, environment, credentials, seed data, and assertions. The generic repository runtime verification proves classification, materialization, and deterministic adapter execution; it does not prove business correctness of an unmapped target.
