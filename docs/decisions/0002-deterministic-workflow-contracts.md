# ADR 0002: Check LLM agents against deterministic workflow contracts

Status: accepted

## Context

The agents that execute scenarios are language models with tools. They are useful because they adapt to the page in front of them. For the same reason they are unreliable judges of their own work: an agent can skip a step, do steps out of order, or declare success after a partial run, and its own report will still sound confident.

Asking a second model to grade the run moves the problem without solving it. The verdict would be non-deterministic, hard to reproduce, and impossible to use as a CI signal.

## Decision

Execution is agentic. Evaluation is deterministic.

- Discovery writes one workflow contract per scenario (`adapter/workflow-contracts/<scenarioId>.generated.yaml`, `deterministic: true`). It lists the ordered steps, the role and capability for each, and the artifacts each step must produce.
- The orchestrator runs steps in contract order. Each agent gets only its current step.
- When a session ends, `contract-evaluation.ts` compares the recorded steps, tools, and artifacts with the contract and assigns `contract_compliant`, `contract_drift`, or `contract_violated`. Plain code makes this decision, not a model.
- `scenario-quality-gates.ts` turns the last 5 verdicts of a scenario into `open`, `review_required`, or `restricted`. A `restricted` scenario cannot be run (HTTP 409) until a person looks at it.
- Sensors (artifacts, schema, timeout, tool policy) and an independent auditor add more checks, and they also run as plain code.

## Consequences

- The same session always gets the same verdict, so verdicts can gate CI and be compared over time.
- A misbehaving agent is detected even when its final message claims success.
- With `AGENTIC_QA_FORCE_DETERMINISTIC_RUNTIME=1`, the model can be replaced entirely and everything else stays the same. Tests and the end-to-end check use this (see [Testing](../testing.md)).
- Contracts are only as good as discovery. A wrong contract produces wrong verdicts, so contracts are generated as reviewable files and should be reviewed.
- Gates are intentionally simple thresholds. They flag scenarios for a person to review. They do not try to diagnose the failure; the L4 failure diagnosis service does that.
- L5 loops can propose new scenarios and prompt changes, but those go through governance before any contract or scenario that runs is changed.
