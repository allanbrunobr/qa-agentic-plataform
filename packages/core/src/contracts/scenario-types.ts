import { z } from 'zod'

export const HandoffContractSchema = z.object({
  nextAgentId: z.string(),
  reason: z.string(),
  requiredArtifacts: z.array(z.string()).default([]),
  expectedOutput: z.string(),
})
export type HandoffContract = z.infer<typeof HandoffContractSchema>

export const ScenarioStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  agentId: z.string(),
  order: z.number(),
  requiredArtifacts: z.array(z.string()).default([]),
  producedArtifacts: z.array(z.string()).default([]),
  timeoutMs: z.number().optional(),
  retryPolicy: z.object({
    maxAttempts: z.number().default(1),
    backoffMs: z.number().default(1000),
  }).optional(),
  handoff: HandoffContractSchema.optional(),
})
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>

export const ScenarioContractSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(ScenarioStepSchema),
  roles: z.array(z.string()).default([]),
  requiredArtifacts: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
})
export type ScenarioContract = z.infer<typeof ScenarioContractSchema>

export const DecisionTypeSchema = z.enum(['delegate', 'retry', 'skip', 'fail', 'escalate'])
export type DecisionType = z.infer<typeof DecisionTypeSchema>

export const OrchestratorDecisionSchema = z.object({
  stepId: z.string(),
  decision: DecisionTypeSchema,
  reason: z.string(),
  attempt: z.number().default(1),
  timestamp: z.string(),
})
export type OrchestratorDecision = z.infer<typeof OrchestratorDecisionSchema>

export const RunResultSchema = z.object({
  sessionId: z.string(),
  scenarioId: z.string(),
  status: z.enum(['complete', 'failed']),
  stepsCompleted: z.number(),
  totalSteps: z.number(),
  decisions: z.array(OrchestratorDecisionSchema),
  durationMs: z.number(),
  error: z.string().optional(),
})
export type RunResult = z.infer<typeof RunResultSchema>
