# ADR 0003: Generic browser capabilities fail closed

Status: accepted

## Context

For a frontend repository with no hand-written adapter, discovery maps scenario steps to generic capabilities: open the primary route, fill a field, add an item, submit, verify feedback. The tools behind them (`templates/persona-qa-dashboard/packages/api/src/phase2/tools/generated-adapter-tools.ts`) must work on an application they have never seen.

The first versions tried to be helpful. If the expected control was missing, they fell back to any enabled button. A verification step passed if any text on the page matched a success word such as "complete" or "order", and a button label like "Complete purchase" is such text. A broken flow could therefore be reported as `contract_compliant`. A QA tool that passes broken software is worse than no tool.

## Decision

Generic capabilities fail when they cannot do exactly what the step asks:

- An action tool looks for the control that matches the step. If no control is found, it fails with "No … was found on the page". If the control is found but cannot be clicked, it fails with "… was found but could not be clicked; it may be disabled or hidden". It never falls back to another control.
- The final verification waits up to 5 seconds for visible success feedback in a non-control element. Buttons, links, and labels are excluded, so a call-to-action is never mistaken for a result. If no success feedback appears, the step fails with `verification_failed` and reports any visible error text.
- A failed tool fails the step, and a failed step makes the contract verdict `contract_violated` (see [ADR 0002](0002-deterministic-workflow-contracts.md)).

## Consequences

- A broken flow produces a failing verdict. The end-to-end check (`npm run test:e2e`) enforces this: it breaks `examples/storefront` on purpose and expects `contract_violated`.
- Some real applications will fail generic scenarios even though they work, for example when success is shown only by a redirect or by a toast that disappears in under 5 seconds. The fix is to adjust the generated capabilities or write an adapter, not to loosen the tools.
- Failures name the missing or disabled control, which makes them actionable.
- Any new generic tool must follow the same rule. Code review should reject fallbacks that "try something else" when the expected control is missing.
