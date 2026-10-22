# ADR 0001: Install a host-local runtime instead of a central service

Status: accepted

## Context

To test an application with agents, the platform needs a lot of knowledge about that application: routes, forms, roles, credentials, how to start it, and which scenarios matter. There are two ways to keep that knowledge:

- **Central service.** One platform holds adapters for every target, connects to each application over the network, and stores all sessions.
- **Host-local runtime.** The platform installs a runtime into each target repository, and the knowledge lives next to the code it describes.

A central service needs network access to every environment, credentials for every target in one place, and an adapter registry that drifts away from the code it describes. It also makes the platform hard to try: someone who wants to evaluate it must first deploy it.

## Decision

`npm run install-local -- <repo>` copies a self-contained runtime (Fastify API, React dashboard, phase 2 agent runtime, SQLite store) into `<repo>/.agentic-qa/`. `npm run discover-local -- <repo>` generates the adapter for that repository into the same directory. The runtime runs on the developer's machine against a locally served app.

The platform keeps only generic code: the installer, discovery, and the runtime template. Knowledge about one target lives in that target's `.agentic-qa/`, or in an adapter under `adapters/` for reference cases.

## Consequences

- Trying the platform takes two commands and an app on localhost. No deployment and no account.
- Credentials stay on the developer's machine, in `.agentic-qa/.env.local`. The installer writes it with mode `0600` and adds `.agentic-qa/.gitignore` so it is not committed.
- Scenarios and workflow contracts can be reviewed in the same pull request as the code they test.
- Each installed runtime is a copy. Fixes to the template reach a target only after `install-local` runs again. `adapter/config/install-metadata.generated.json` records which template was installed.
- There is no cross-repository view of results. The optional platform dashboard (`npm run dev:api` / `dev:web`) reviews discovery output and adapter promotion, but it does not collect sessions from installed runtimes.
- The installer must keep the copy self-contained. For example it replaces the native `better-sqlite3` dependency with a shim over `node:sqlite`, which is why the runtime needs Node 22.5 or later.
