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
