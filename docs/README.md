# Developer documentation

Start with the [project README](../README.md) for the quick start. The pages below explain how the platform works and why it is built this way.

| Document | Read it when you want to know |
| --- | --- |
| [Architecture](architecture.md) | Which components exist, how data flows from a repository to a run verdict, the L1–L5 maturity model, and the security boundaries. |
| [Generated files](generated-files.md) | What `install-local` and `discover-local` write into `<repo>/.agentic-qa/`, and which files you should review or edit. |
| [Testing](testing.md) | The test layers, how to run each one (or a single test), and the deterministic runtime. |
| [Contributor and agent guidelines](../AGENTIC.md) | Commands, conventions, and the rules for changes to this repository. |

## Architecture decision records

Short records of the decisions that shape the codebase. Each one has the context, the decision, and its consequences.

| ADR | Decision |
| --- | --- |
| [0001](decisions/0001-host-local-runtime.md) | Install a self-contained runtime inside the target repository instead of running a central service. |
| [0002](decisions/0002-deterministic-workflow-contracts.md) | Check LLM agents against deterministic workflow contracts and quality gates. |
| [0003](decisions/0003-fail-closed-generic-capabilities.md) | Generic browser capabilities fail closed. |
| [0004](decisions/0004-untrusted-repository-content.md) | Treat repository content as untrusted input at an ingestion boundary. |

To add an ADR, copy the structure of an existing one, use the next number, and link it here.
