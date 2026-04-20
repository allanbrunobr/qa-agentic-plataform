import { buildContractEvaluation } from './contract-evaluation.js'
import { L5LoopGuardService } from './l5-loop-guard-service.js'
import { MetaOrchestrator } from './meta-orchestrator.js'
import { buildScenarioQualityGateMap } from './scenario-quality-gates.js'
import type { SessionService } from './session-service.js'

export type MaturityCapabilityState = 'complete' | 'guarded' | 'beta'
export type L4MaturityStatus = 'ready' | 'stable' | 'attention'
export type L5MaturityStatus = 'operational' | 'controlled_beta' | 'attention'

export interface MaturityCapability {
  id: string
  label: string
  state: MaturityCapabilityState
  evidence: string
}

export interface MaturitySignal {
  label: string
  value: number | string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

export interface L4MaturityLevel {
  level: 'L4'
  status: L4MaturityStatus
  completion: number
  verdict: string
  summary: string
  capabilities: MaturityCapability[]
  signals: MaturitySignal[]
}

export interface L5MaturityLevel {
  level: 'L5'
  status: L5MaturityStatus
  completion: number
  verdict: string
  summary: string
  capabilities: MaturityCapability[]
  signals: MaturitySignal[]
}

export interface MaturityStatus {
  generatedAt: string
  releaseGate: 'ready' | 'attention'
  levels: {
    l4: L4MaturityLevel
    l5: L5MaturityLevel
  }
}

export function buildMaturityStatus(sessionService: SessionService): MaturityStatus {
  const sessions = sessionService.getAllSessions()
  const finalSessions = sessions.filter((session) => (
    session.status === 'complete' || session.status === 'failed'
  ))
  const evaluations = finalSessions
    .map((session) => buildContractEvaluation(session).contractEvaluation)
    .filter((evaluation): evaluation is NonNullable<typeof evaluation> => evaluation !== null)

  const contractViolations = evaluations.filter((evaluation) => evaluation.verdict === 'contract_violated').length
  const contractDrift = evaluations.filter((evaluation) => evaluation.verdict === 'contract_drift').length
  const compliantContracts = evaluations.filter((evaluation) => evaluation.verdict === 'contract_compliant').length
  const qualityGates = Object.values(buildScenarioQualityGateMap(sessionService))
  const restrictedGates = qualityGates.filter((gate) => gate.status === 'restricted').length
  const reviewGates = qualityGates.filter((gate) => gate.status === 'review_required').length

  const learningProposals = sessionService.listLearningProposals({ limit: 500 })
  const scenarioDrafts = sessionService.listScenarioDrafts({ limit: 500 })
  const healingActions = sessionService.listHealingActions({ limit: 500 })
  const governanceDecisions = sessionService.listGovernanceDecisions({ limit: 500 })
  const materializations = sessionService.listL5Materializations({ limit: 500 })
  const loopGuards = new L5LoopGuardService(sessionService).summarize()
  const queueItems = new MetaOrchestrator(sessionService).buildGovernedRunQueue(10)

  const pendingReviews = learningProposals.filter((proposal) => proposal.status === 'proposed').length
    + scenarioDrafts.filter((draft) => draft.status === 'pending').length
    + healingActions.filter((action) => action.status === 'proposed').length
  const blockedDecisions = governanceDecisions.filter((decision) => decision.verdict === 'blocked').length
  const independentAudits = governanceDecisions.filter((decision) => (
    decision.requirements?.includes('independent_audit')
  )).length
  const boundedAutomaticActions = governanceDecisions.filter((decision) => (
    decision.subjectType === 'healing_action'
    && decision.verdict === 'allowed'
    && decision.requirements?.includes('bounded_policy')
  )).length
  const activeMaterializations = materializations.filter((materialization) => materialization.status === 'active').length
  const verifiedMaterializations = materializations.filter((materialization) => {
    const metadata = materialization.metadata ?? {}
    const audit = metadata['independentAudit'] as Record<string, unknown> | undefined
    const verification = metadata['postWriteVerification'] as Record<string, unknown> | undefined
    return audit?.['verdict'] === 'passed' && verification?.['checksumMatches'] === true
  }).length
  const blockedLoops = loopGuards.filter((guard) => guard.status === 'blocked').length
  const queuedMetaRuns = queueItems.filter((item) => item.status === 'queued').length

  const l4Status: L4MaturityStatus = restrictedGates > 0 || contractViolations > 0
    ? 'attention'
    : finalSessions.length > 0
      ? 'stable'
      : 'ready'
  const l5Status: L5MaturityStatus = blockedDecisions > 0 || blockedLoops > 0
    ? 'attention'
    : verifiedMaterializations > 0 && independentAudits > 0 && pendingReviews === 0 && queuedMetaRuns > 0
      ? 'operational'
      : 'controlled_beta'

  return {
    generatedAt: new Date().toISOString(),
    releaseGate: l4Status === 'attention' || l5Status === 'attention' ? 'attention' : 'ready',
    levels: {
      l4: {
        level: 'L4',
        status: l4Status,
        completion: l4Status === 'attention' ? 90 : 95,
        verdict: l4Status === 'attention' ? 'Atenção operacional' : 'Baseline operacional',
        summary: 'Execução multiagente, contratos, quality gates, evidência e recuperação estão no fluxo principal.',
        capabilities: [
          {
            id: 'workflow_contracts',
            label: 'Workflow contracts',
            state: 'complete',
            evidence: 'Contratos determinísticos avaliados por sessão.',
          },
          {
            id: 'tool_governance',
            label: 'Tool governance',
            state: 'complete',
            evidence: 'Ferramentas passam por registry, políticas e ledger.',
          },
          {
            id: 'instruction_governance',
            label: 'Instruction governance',
            state: 'complete',
            evidence: 'Camadas de instrução têm precedência, validação e budget.',
          },
          {
            id: 'quality_gates',
            label: 'Quality gates',
            state: 'complete',
            evidence: 'Cenários podem entrar em review ou restricted por histórico.',
          },
          {
            id: 'runtime_evidence',
            label: 'Runtime evidence',
            state: 'complete',
            evidence: 'Screenshots em branco são recusados e artifacts obrigatórios encerram o step.',
          },
        ],
        signals: [
          { label: 'Sessões finais', value: finalSessions.length, tone: 'neutral' },
          { label: 'Contratos compliant', value: compliantContracts, tone: 'success' },
          { label: 'Contratos violados', value: contractViolations, tone: contractViolations > 0 ? 'danger' : 'success' },
          { label: 'Drift signals', value: contractDrift, tone: contractDrift > 0 ? 'warning' : 'success' },
          { label: 'Quality gates restricted', value: restrictedGates, tone: restrictedGates > 0 ? 'danger' : 'success' },
          { label: 'Quality gates em review', value: reviewGates, tone: reviewGates > 0 ? 'warning' : 'neutral' },
        ],
      },
      l5: {
        level: 'L5',
        status: l5Status,
        completion: l5Status === 'operational' ? 95 : activeMaterializations > 0 && independentAudits > 0 ? 80 : 70,
        verdict: l5Status === 'attention'
          ? 'Governança requer revisão'
          : l5Status === 'operational'
            ? 'Operacional governado'
            : 'Beta controlado',
        summary: l5Status === 'operational'
          ? 'Aprendizado, healing, auditoria, materialização verificada e fila meta-orquestrada estão governados.'
          : 'Aprendizado, healing, auditoria independente e materialização existem, mas mudanças seguem governadas.',
        capabilities: [
          {
            id: 'learning_control',
            label: 'Learning control',
            state: 'guarded',
            evidence: 'Propostas passam por aprovação antes de aplicação.',
          },
          {
            id: 'independent_audit',
            label: 'Independent audit',
            state: 'guarded',
            evidence: 'Decisões de governança recebem auditoria independente.',
          },
          {
            id: 'self_healing',
            label: 'Self-healing',
            state: 'guarded',
            evidence: 'Ações automáticas são limitadas por bounded policy.',
          },
          {
            id: 'materialization',
            label: 'Materialization',
            state: verifiedMaterializations > 0 ? 'complete' : 'guarded',
            evidence: verifiedMaterializations > 0
              ? 'Mudanças aplicadas geram artifacts duráveis com auditoria e checksum verificados.'
              : 'Mudanças aplicadas geram artifacts duráveis e rastreáveis.',
          },
          {
            id: 'meta_orchestration',
            label: 'Meta-orchestration',
            state: queuedMetaRuns > 0 ? 'guarded' : 'beta',
            evidence: queuedMetaRuns > 0
              ? 'Fila governada de execução ordena cenários por risco e respeita circuit breakers.'
              : 'Priorização existe como recomendação, aguardando fila governada.',
          },
          {
            id: 'circuit_breakers',
            label: 'Circuit breakers',
            state: blockedLoops === 0 ? 'complete' : 'guarded',
            evidence: 'Learning, geração de cenários, healing, materialização e meta-orchestration têm limites formais.',
          },
        ],
        signals: [
          { label: 'Revisões pendentes', value: pendingReviews, tone: pendingReviews > 0 ? 'warning' : 'success' },
          { label: 'Decisões bloqueadas', value: blockedDecisions, tone: blockedDecisions > 0 ? 'danger' : 'success' },
          { label: 'Loops bloqueados', value: blockedLoops, tone: blockedLoops > 0 ? 'danger' : 'success' },
          { label: 'Auditorias independentes', value: independentAudits, tone: independentAudits > 0 ? 'success' : 'neutral' },
          { label: 'Ações bounded', value: boundedAutomaticActions, tone: boundedAutomaticActions > 0 ? 'success' : 'neutral' },
          { label: 'Materializações ativas', value: activeMaterializations, tone: activeMaterializations > 0 ? 'success' : 'neutral' },
          { label: 'Materializações verificadas', value: verifiedMaterializations, tone: verifiedMaterializations > 0 ? 'success' : 'neutral' },
          { label: 'Fila meta-orquestrada', value: queuedMetaRuns, tone: queuedMetaRuns > 0 ? 'success' : 'neutral' },
        ],
      },
    },
  }
}
