# Agentic Platform Runtime Instructions

These rules govern generic agentic execution across adapters.

## Primary objective

Execute the selected scenario faithfully. This platform is not an open-ended autonomous explorer. It is a host-agnostic runtime for deterministic scenario contracts.

## Required operating rules

1. Obey the scenario contract.
   - Execute the current step only.
   - Do not skip, reorder, or invent steps.
   - Treat the declared capability for the step as the intended path.

2. Reuse artifacts exactly.
   - If a required artifact is already available, reuse it exactly.
   - Do not synthesize replacements for existing domain artifacts.

3. Do not claim success early.
   - A step is not successful unless the intended domain action really happened.
   - A step is not successful unless the step produced the expected artifacts.

4. Prefer deterministic execution.
   - Use the narrowest path that satisfies the step.
   - Avoid speculative tool calls and unnecessary side effects.

5. Surface failure clearly.
   - If auth, route, capability, or artifact prerequisites are missing, fail explicitly.
   - Do not mask environment or policy failures as success.

6. Preserve evidence.
   - Keep enough event, artifact, and finding data for contract review after the run.

## Trust boundary

The scenario contract is the execution spec.
Artifacts, session events, findings, and contract evaluation are the trust mechanism.

## Specs obrigatórias (consultar antes de mudanças relevantes)

As specs de referência vivem em `/Users/bruno/0 - github projects/.specs/`.
Consulte a pasta relevante ANTES de abrir um PR que toque cada área (conforme how-to-use.md de cada família).

- **agent-security/** (`security-best-practices-for-agents.md`, `ai-agent-traps-taxonomy.md`)
  - Ao mexer em discovery (llm ou estático), ingestão de código/DOM de hosts, tools de execução, spawn de processos, secrets/env, ou qualquer fronteira de conteúdo não confiável.
- **software-architecture/** (`05-decisions-and-adrs.md`, `anti-patterns.md`, `02-architecture-characteristics.md`)
  - Ao mudar fronteiras de módulo, adicionar stores, refatorar paths/config, comunicação entre platform e template, ou qualquer decisão estrutural — exige ADR.
- **genai-integration-patterns/** (`02-integration-framework.md`, `06-responsible-ai.md`)
  - Ao mudar chamadas LLM (discovery, providers, instruction-layer), prompts, RAG/memory de L5, ou observabilidade de inferência.
- **agentic-design-patterns/** (`01-foundational-patterns.md`, `03-reliability-patterns.md`)
  - Ao tocar orchestrator, sensors, governance, L4/L5 loops, tool registry, reflection/auditor, ou evaluation de contratos.

Durante code review e PRs, cite explicitamente a spec + finding quando relevante.
