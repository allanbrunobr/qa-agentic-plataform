import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import {
  resolvePhase2ArtifactPath,
  type L5Materialization,
  type L5MaterializationSubjectType,
  type LearningProposal,
  type ScenarioDraft,
  type SessionService,
} from './session-service.js'
import { IndependentAuditorService, type MaterializationAuditEvaluation } from './independent-auditor-service.js'
import { L5LoopGuardService } from './l5-loop-guard-service.js'

export interface L5MaterializationOptions {
  artifactRoot?: string
}

export interface L5ScenarioDraftPromotionMaterialization {
  manifest: L5Materialization
  runnableScenarioRegistry: L5Materialization
}

interface AdapterScenarioStepModel {
  id: string
  roleId: string
  capabilityId: string
  producesArtifacts?: string[]
}

interface AdapterScenarioModel {
  id: string
  title: string
  roles: string[]
  steps: string[]
  expectedArtifacts?: string[]
  stepDefinitions?: AdapterScenarioStepModel[]
  source?: Record<string, unknown>
}

export class L5MaterializationService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly options: L5MaterializationOptions = {},
  ) {}

  async promoteScenarioDraftToRunnable(draft: ScenarioDraft): Promise<L5ScenarioDraftPromotionMaterialization> {
    const manifest = await this.materializeScenarioDraft(draft)
    const runnableScenarioRegistry = await this.materializeRunnableScenarioDraft(draft)
    return { manifest, runnableScenarioRegistry }
  }

  async materializeScenarioDraft(draft: ScenarioDraft): Promise<L5Materialization> {
    const fileName = `${safeFileSegment(draft.scenarioId || draft.id)}.json`
    const payload = stableStringify({
      schemaVersion: 1,
      kind: 'scenario_draft',
      source: {
        draftId: draft.id,
        scenarioId: draft.scenarioId,
        status: draft.status,
        reviewedBy: draft.reviewedBy ?? null,
        reviewedAt: draft.reviewedAt ?? null,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      },
      scenario: {
        id: draft.scenarioId,
        name: draft.name,
        description: draft.description ?? null,
        contract: draft.contract,
      },
      gap: {
        type: draft.gapType,
        evidence: draft.gapEvidence ?? [],
      },
    })

    return this.writeAndRecord({
      subjectType: 'scenario_draft',
      subjectId: draft.id,
      kind: 'scenario_draft_manifest',
      directory: 'scenario-drafts',
      fileName,
      content: payload,
      metadata: {
        scenarioId: draft.scenarioId,
        status: draft.status,
        source: 'scenario_draft_promotion',
      },
    })
  }

  async materializeLearningProposal(proposal: LearningProposal): Promise<L5Materialization> {
    if (proposal.patchKind === 'prompt_overlay') {
      return this.materializePromptOverlay(proposal)
    }

    const fileName = `${safeFileSegment(proposal.scenarioId)}-${safeFileSegment(proposal.stepId)}-${proposal.id}.json`
    const payload = stableStringify({
      schemaVersion: 1,
      kind: 'learning_proposal',
      source: proposalSource(proposal),
      patch: {
        kind: proposal.patchKind,
        target: proposal.target ?? null,
        content: proposal.patchContent ?? null,
      },
      recommendation: proposal.recommendation,
      metadata: proposal.metadata ?? {},
    })

    return this.writeAndRecord({
      subjectType: 'learning_proposal',
      subjectId: proposal.id,
      kind: 'learning_proposal_manifest',
      directory: 'learning-proposals',
      fileName,
      content: payload,
      metadata: {
        scenarioId: proposal.scenarioId,
        stepId: proposal.stepId,
        patchKind: proposal.patchKind,
        target: proposal.target ?? null,
        source: 'learning_proposal_apply',
      },
    })
  }

  private async materializePromptOverlay(proposal: LearningProposal): Promise<L5Materialization> {
    const fileName = `${safeFileSegment(proposal.scenarioId)}-${safeFileSegment(proposal.stepId)}-${proposal.id}.md`
    const content = [
      '# L5 Learning Overlay',
      '',
      `Proposal: ${proposal.id}`,
      `Scenario: ${proposal.scenarioId}`,
      `Step: ${proposal.stepId}`,
      `Agent: ${proposal.agentId ?? 'unspecified'}`,
      `Target: ${proposal.target ?? 'unspecified'}`,
      '',
      '## Overlay',
      proposal.patchContent ?? '',
      '',
      '## Recommendation',
      '```json',
      stableStringify(proposal.recommendation).trimEnd(),
      '```',
      '',
    ].join('\n')

    return this.writeAndRecord({
      subjectType: 'learning_proposal',
      subjectId: proposal.id,
      kind: 'learning_prompt_overlay',
      directory: 'learning-overlays',
      fileName,
      content,
      metadata: {
        scenarioId: proposal.scenarioId,
        stepId: proposal.stepId,
        agentId: proposal.agentId ?? null,
        patchKind: proposal.patchKind,
        target: proposal.target ?? null,
        source: 'learning_proposal_apply',
      },
    })
  }

  private async materializeRunnableScenarioDraft(draft: ScenarioDraft): Promise<L5Materialization> {
    const registryPath = resolvePromotedScenarioRegistryPath()
    const scenario = scenarioDraftToAdapterScenario(draft)
    const scenarios = upsertScenario(readScenarioRegistry(registryPath.absolutePath), scenario)
    const payload = stableStringify(scenarios)

    return this.writeAndRecord({
      subjectType: 'scenario_draft',
      subjectId: draft.id,
      kind: 'runnable_scenario_registry',
      directory: 'scenario-drafts',
      fileName: path.basename(registryPath.absolutePath),
      content: payload,
      metadata: {
        scenarioId: draft.scenarioId,
        registryPath: registryPath.storagePath,
        source: 'scenario_draft_promotion',
      },
      absolutePath: registryPath.absolutePath,
      storagePath: registryPath.storagePath,
    })
  }

  private async writeAndRecord(input: {
    subjectType: L5MaterializationSubjectType
    subjectId: string
    kind: string
    directory: string
    fileName: string
    content: string
    metadata: Record<string, unknown>
    absolutePath?: string
    storagePath?: string
  }): Promise<L5Materialization> {
    new L5LoopGuardService(this.sessionService).assertLoopOpen('materialization')
    const { absolutePath, storagePath } = input.absolutePath && input.storagePath
      ? { absolutePath: input.absolutePath, storagePath: input.storagePath }
      : this.resolveStoragePath(input.directory, input.fileName)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, input.content, 'utf8')

    const checksum = createHash('sha256').update(input.content).digest('hex')
    const persistedContent = await readFile(absolutePath, 'utf8')
    const independentAudit = new IndependentAuditorService().evaluateMaterialization({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      kind: input.kind,
      filePath: storagePath,
      checksum,
      persistedContent,
      sessionService: this.sessionService,
    })

    if (independentAudit.verdict === 'failed') {
      throw new Error(`L5 materialization audit failed: ${independentAudit.findings.map((finding) => finding.code).join(', ')}`)
    }

    return this.sessionService.recordL5Materialization({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      kind: input.kind,
      filePath: storagePath,
      checksum,
      metadata: {
        ...input.metadata,
        independentAudit: serializeMaterializationAudit(independentAudit),
        postWriteVerification: {
          checksumMatches: persistedContent === input.content,
          verifiedAt: independentAudit.checkedAt,
          verifier: 'independent_auditor',
        },
        absolutePath,
      },
    })
  }

  private resolveStoragePath(directory: string, fileName: string): { absolutePath: string; storagePath: string } {
    if (this.options.artifactRoot) {
      const absolutePath = path.resolve(this.options.artifactRoot, directory, fileName)
      return { absolutePath, storagePath: absolutePath }
    }

    const storagePath = path.join('l5', directory, fileName)
    const envArtifactRoot = process.env['PHASE2_ARTIFACT_DIR']
    if (envArtifactRoot) {
      return {
        absolutePath: path.resolve(envArtifactRoot, storagePath),
        storagePath,
      }
    }

    return {
      absolutePath: resolvePhase2ArtifactPath(storagePath),
      storagePath,
    }
  }
}

function scenarioDraftToAdapterScenario(draft: ScenarioDraft): AdapterScenarioModel {
  const contract = draft.contract as Record<string, unknown>
  const steps = Array.isArray(contract['steps'])
    ? contract['steps'].filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object' && !Array.isArray(step))
    : []
  const roles = Array.isArray(contract['roles'])
    ? contract['roles'].filter((role): role is string => typeof role === 'string')
    : []
  const requiredArtifacts = Array.isArray(contract['requiredArtifacts'])
    ? contract['requiredArtifacts'].filter((artifact): artifact is string => typeof artifact === 'string')
    : []

  return {
    id: draft.scenarioId,
    title: typeof contract['name'] === 'string' ? contract['name'] : draft.name,
    roles,
    steps: steps.map((step, index) => readString(step['id'], `step_${index + 1}`)),
    expectedArtifacts: requiredArtifacts,
    stepDefinitions: steps.map((step, index) => ({
      id: readString(step['id'], `step_${index + 1}`),
      roleId: readString(step['agentId'], roles[0] ?? 'domain_reviewer'),
      capabilityId: readString(step['capabilityId'], readString(step['id'], `step_${index + 1}`)),
      producesArtifacts: Array.isArray(step['producedArtifacts'])
        ? step['producedArtifacts'].filter((artifact): artifact is string => typeof artifact === 'string')
        : [],
    })),
    source: {
      kind: 'scenario_draft',
      draftId: draft.id,
      promotedAt: new Date().toISOString(),
      reviewedBy: draft.reviewedBy ?? null,
    },
  }
}

function resolvePromotedScenarioRegistryPath(): { absolutePath: string; storagePath: string } {
  const explicit = process.env['PERSONA_QA_PROMOTED_SCENARIOS_FILE']
  if (explicit) {
    const absolutePath = path.resolve(explicit)
    return { absolutePath, storagePath: absolutePath }
  }

  const generated = process.env['PERSONA_QA_SCENARIOS_FILE']
  const directory = generated
    ? path.dirname(path.resolve(generated))
    : path.resolve(process.cwd(), 'adapter', 'scenarios')
  const absolutePath = path.join(directory, 'scenarios.promoted.json')
  return { absolutePath, storagePath: absolutePath }
}

function readScenarioRegistry(filePath: string): AdapterScenarioModel[] {
  if (!fs.existsSync(filePath)) return []

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((scenario): scenario is AdapterScenarioModel => (
      Boolean(scenario)
      && typeof scenario === 'object'
      && typeof (scenario as AdapterScenarioModel).id === 'string'
      && typeof (scenario as AdapterScenarioModel).title === 'string'
      && Array.isArray((scenario as AdapterScenarioModel).roles)
      && Array.isArray((scenario as AdapterScenarioModel).steps)
    ))
  } catch {
    return []
  }
}

function upsertScenario(scenarios: AdapterScenarioModel[], scenario: AdapterScenarioModel): AdapterScenarioModel[] {
  return [
    ...scenarios.filter((existing) => existing.id !== scenario.id),
    scenario,
  ].sort((left, right) => left.id.localeCompare(right.id))
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function serializeMaterializationAudit(audit: MaterializationAuditEvaluation): Record<string, unknown> {
  return {
    verdict: audit.verdict,
    checkedAt: audit.checkedAt,
    findings: audit.findings.map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      message: finding.message,
      evidence: finding.evidence,
    })),
    requirements: audit.summary.requirements,
    checksumVerified: audit.summary.checksumVerified,
    governanceEvidence: audit.summary.governanceEvidence,
  }
}

function proposalSource(proposal: LearningProposal): Record<string, unknown> {
  return {
    proposalId: proposal.id,
    recommendationId: proposal.recommendationId,
    scenarioId: proposal.scenarioId,
    stepId: proposal.stepId,
    agentId: proposal.agentId ?? null,
    status: proposal.status,
    createdAt: proposal.createdAt,
    approvedAt: proposal.approvedAt ?? null,
    appliedAt: proposal.appliedAt ?? null,
  }
}

function safeFileSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return normalized || 'item'
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  )
}
