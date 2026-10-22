# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/allanbrunobr/qa-agentic-plataform/security/advisories/new)
instead. Include the affected version or commit, steps to reproduce, and the impact you expect.

You should get a first answer within 7 days.

## Scope

This is an alpha, single-maintainer project. The areas that matter most:

- **Repository content reaching LLM prompts.** Files from the target repository are untrusted input.
  They pass through the ingestion boundary (`packages/dashboard-api/src/ingestion/boundary.ts`)
  before any prompt is built. Bypasses of this boundary are in scope.
- **Secrets.** The installer can write a provider key to `<repo>/.agentic-qa/.env.local`.
  Any path that logs, commits, or sends that key elsewhere is in scope.
- **Host code.** `install-local` and `discover-local` must only write inside `<repo>/.agentic-qa/`.
  A write outside that directory is a bug.

Running the generated dashboard on a public interface is not supported. Bind it to localhost.
