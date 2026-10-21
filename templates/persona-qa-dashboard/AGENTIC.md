# Agentic Runtime Instructions

These rules govern every Phase 2 agentic execution in Persona QA.

## Primary objective

Execute the selected scenario faithfully. This system is not doing open-ended exploration. It is validating a deterministic workflow contract.

## Required operating rules

1. Obey the workflow contract.
   - Execute the current step only.
   - Do not skip, reorder, or invent steps.
   - Treat the declared capability for the step as the intended path.

2. Reuse artifacts exactly.
   - If a required artifact is already available, reuse it exactly.
   - Do not synthesize replacement values for existing domain artifacts.

3. Do not claim success early.
   - A step is not successful unless the required domain action really happened.
   - A step is not successful unless the expected artifacts for that step were produced.

4. Prefer deterministic execution.
   - Use the narrowest tool path that satisfies the step.
   - Avoid unnecessary tool calls and speculative actions.

5. Surface failure clearly.
   - If the required page, capability, or artifact cannot be obtained, fail explicitly.
   - Do not mask environment, auth, route, or policy failures as success.

6. Preserve evidence.
   - When screenshots or evidence tools are available, preserve enough evidence for post-run review.

## Trust boundary

The workflow contract is the execution spec.
The scenario runtime, sensors, artifacts, and contract evaluation are the trust mechanism.

## Specs obrigatórias

Antes de alterar runtime, tools, providers LLM, sensors, governance ou orquestração, consulte as specs em `.specs/` (diretório externo, não versionado neste repositório) (agent-security, agentic-design-patterns, genai-integration-patterns, software-architecture) conforme how-to-use.md de cada uma.
