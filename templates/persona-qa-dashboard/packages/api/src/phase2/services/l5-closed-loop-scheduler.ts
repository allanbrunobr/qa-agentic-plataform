import { L5ClosedLoopService, type L5ClosedLoopRunOptions } from './l5-closed-loop-service.js'
import type { L5ClosedLoopRun, SessionService } from './session-service.js'

export interface L5ClosedLoopSchedulerOptions extends L5ClosedLoopRunOptions {
  intervalMs?: number
  runImmediately?: boolean
}

export interface L5ClosedLoopSchedulerState {
  enabled: boolean
  running: boolean
  intervalMs: number
  minIntervalMs: number
  maxConsecutiveFailures: number
  nextTickAt: string | null
  startedAt: string | null
  stoppedAt: string | null
  lastTickStartedAt: string | null
  lastTickCompletedAt: string | null
  tickCount: number
  failureCount: number
  consecutiveFailures: number
  lastRunId: string | null
  lastError: string | null
  options: {
    scenarioId?: string
    maxScenarios: number
    applyApprovedChanges: boolean
    generateScenarioDrafts: boolean
    maxApprovedApplies: number
    actor: string
  }
}

export interface L5ClosedLoopSchedulerTickResult {
  status: 'executed' | 'skipped' | 'failed'
  reason?: string
  error?: string
  run?: L5ClosedLoopRun
  scheduler: L5ClosedLoopSchedulerState
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000
const DEFAULT_MIN_INTERVAL_MS = 60 * 1000
const DEFAULT_MAX_SCENARIOS = 3
const DEFAULT_MAX_APPROVED_APPLIES = 3
const DEFAULT_ACTOR = 'l5_closed_loop_scheduler'
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3

export class L5ClosedLoopScheduler {
  private enabled = false
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private intervalMs = DEFAULT_INTERVAL_MS
  private readonly minIntervalMs: number
  private readonly maxConsecutiveFailures: number
  private nextTickAt: string | null = null
  private startedAt: string | null = null
  private stoppedAt: string | null = null
  private lastTickStartedAt: string | null = null
  private lastTickCompletedAt: string | null = null
  private tickCount = 0
  private failureCount = 0
  private consecutiveFailures = 0
  private lastRunId: string | null = null
  private lastError: string | null = null
  private runOptions: Required<Omit<L5ClosedLoopRunOptions, 'scenarioId'>> & { scenarioId?: string } = {
    maxScenarios: DEFAULT_MAX_SCENARIOS,
    applyApprovedChanges: false,
    generateScenarioDrafts: false,
    actor: DEFAULT_ACTOR,
    maxApprovedApplies: DEFAULT_MAX_APPROVED_APPLIES,
  }

  constructor(
    private readonly sessionService: SessionService,
    options: { minIntervalMs?: number; maxConsecutiveFailures?: number } = {},
  ) {
    this.minIntervalMs = Math.max(1, Math.floor(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS))
    this.maxConsecutiveFailures = Math.max(1, Math.floor(options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES))
  }

  status(): L5ClosedLoopSchedulerState {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      minIntervalMs: this.minIntervalMs,
      maxConsecutiveFailures: this.maxConsecutiveFailures,
      nextTickAt: this.nextTickAt,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      lastTickStartedAt: this.lastTickStartedAt,
      lastTickCompletedAt: this.lastTickCompletedAt,
      tickCount: this.tickCount,
      failureCount: this.failureCount,
      consecutiveFailures: this.consecutiveFailures,
      lastRunId: this.lastRunId,
      lastError: this.lastError,
      options: { ...this.runOptions },
    }
  }

  start(options: L5ClosedLoopSchedulerOptions = {}): L5ClosedLoopSchedulerState {
    this.configure(options)
    this.enabled = true
    this.startedAt = new Date().toISOString()
    this.stoppedAt = null
    this.lastError = null
    this.clearTimer()

    if (options.runImmediately) {
      void this.tick().finally(() => this.scheduleNext())
    } else {
      this.scheduleNext()
    }

    return this.status()
  }

  stop(reason = 'stopped'): L5ClosedLoopSchedulerState {
    this.enabled = false
    this.stoppedAt = new Date().toISOString()
    this.nextTickAt = null
    this.lastError = reason
    this.clearTimer()
    return this.status()
  }

  async tick(overrides: L5ClosedLoopRunOptions = {}): Promise<L5ClosedLoopSchedulerTickResult> {
    if (this.running) {
      return {
        status: 'skipped',
        reason: 'already_running',
        scheduler: this.status(),
      }
    }

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      return {
        status: 'skipped',
        reason: 'circuit_breaker_open',
        scheduler: this.status(),
      }
    }

    const options = { ...this.runOptions, ...overrides }
    const startedAt = new Date().toISOString()
    this.running = true
    this.lastTickStartedAt = startedAt
    this.nextTickAt = null

    try {
      const run = await new L5ClosedLoopService(this.sessionService).runOnce(options)
      this.tickCount += 1
      this.consecutiveFailures = 0
      this.lastRunId = run.id
      this.lastError = null
      this.lastTickCompletedAt = new Date().toISOString()
      this.running = false

      return {
        status: 'executed',
        run,
        scheduler: this.status(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.tickCount += 1
      this.failureCount += 1
      this.consecutiveFailures += 1
      this.lastError = message
      this.lastTickCompletedAt = new Date().toISOString()

      const run = this.sessionService.recordL5ClosedLoopRun({
        status: 'failed',
        mode: options.applyApprovedChanges ? 'apply_approved' : 'observe',
        scenarioId: options.scenarioId,
        queuedScenarios: [],
        actions: [{ type: 'scheduler_error', error: message }],
        verification: {
          rerunRequired: false,
          recommendation: 'Fix the scheduler error before enabling autonomous L5 execution again.',
        },
        summary: {
          statusReason: 'Closed loop scheduler failed before completing an iteration.',
          error: message,
        },
        metadata: {
          scheduler: this.status(),
        },
        startedAt,
        completedAt: this.lastTickCompletedAt,
      })
      this.lastRunId = run.id

      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.enabled = false
        this.stoppedAt = new Date().toISOString()
        this.clearTimer()
      }
      this.running = false

      return {
        status: 'failed',
        error: message,
        run,
        scheduler: this.status(),
      }
    } finally {
      this.running = false
    }
  }

  private configure(options: L5ClosedLoopSchedulerOptions): void {
    if (options.intervalMs !== undefined) {
      this.intervalMs = Math.max(this.minIntervalMs, Math.floor(options.intervalMs))
    }
    if (options.scenarioId !== undefined) this.runOptions.scenarioId = options.scenarioId
    if (options.maxScenarios !== undefined) this.runOptions.maxScenarios = clamp(options.maxScenarios, 1, 10)
    if (options.applyApprovedChanges !== undefined) this.runOptions.applyApprovedChanges = options.applyApprovedChanges
    if (options.generateScenarioDrafts !== undefined) this.runOptions.generateScenarioDrafts = options.generateScenarioDrafts
    if (options.actor !== undefined) this.runOptions.actor = options.actor
    if (options.maxApprovedApplies !== undefined) this.runOptions.maxApprovedApplies = clamp(options.maxApprovedApplies, 0, 10)
  }

  private scheduleNext(): void {
    if (!this.enabled || this.running) return
    this.clearTimer()

    const nextTick = Date.now() + this.intervalMs
    this.nextTickAt = new Date(nextTick).toISOString()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick().finally(() => this.scheduleNext())
    }, this.intervalMs)
    const timer = this.timer as ReturnType<typeof setTimeout> & { unref?: () => void }
    timer.unref?.()
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.floor(value), max))
}
