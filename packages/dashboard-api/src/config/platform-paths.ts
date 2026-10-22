import path from 'node:path'

/**
 * Portable path resolution for the agentic-platform.
 *
 * Never hardcode author machine paths. All data and adapter roots are resolved
 * relative to process.cwd() (run commands from the qa-agentic-plataform checkout)
 * or overridden via environment variables for CI / alternate layouts.
 *
 * Rationale: portability, least privilege, no personal state in source.
 * See AGENTIC.md and docs/architecture.md.
 */

export const PLATFORM_ROOT =
  process.env.AGENTIC_PLATFORM_ROOT || process.cwd()

export const DATA_DIR =
  process.env.AGENTIC_DATA_DIR || path.resolve(PLATFORM_ROOT, 'data')

export const ADAPTERS_ROOT =
  process.env.AGENTIC_ADAPTERS_ROOT || path.resolve(PLATFORM_ROOT, 'adapters')

// Concrete data files (JSON stores for the dashboard-api layer)
export const EXECUTIONS_DATA_PATH = path.join(DATA_DIR, 'executions.json')
export const SESSIONS_DATA_PATH = path.join(DATA_DIR, 'sessions.json')
export const ADAPTER_PROMOTIONS_DATA_PATH = path.join(
  DATA_DIR,
  'adapter-promotions.json',
)

/**
 * Safely resolve the generated/ dir for a given adapterId.
 * Rejects obviously dangerous adapterIds (path traversal guard).
 */
export function resolveGeneratedDir(adapterId: string): string {
  // Strict allowlist: alphanum, underscore, hyphen; optional -generated suffix only
  if (!/^[a-z0-9_-]+(-generated)?$/i.test(adapterId)) {
    throw new Error(
      `Invalid adapterId (potential path traversal): ${adapterId}. ` +
        'Only [a-z0-9_-] characters and optional -generated suffix are allowed.',
    )
  }

  const base = adapterId.endsWith('-generated')
    ? adapterId.slice(0, -'-generated'.length)
    : adapterId

  return path.join(ADAPTERS_ROOT, base, 'src', 'model', 'generated')
}

/**
 * Convenience: resolve a specific generated file path (after validation).
 */
export function resolveGeneratedFile(
  adapterId: string,
  filename: string,
): string {
  // Filename already asserted by callers for [a-z0-9._-] but double-check here
  if (!/^[a-z0-9._-]+$/i.test(filename)) {
    throw new Error(`Invalid generated filename: ${filename}`)
  }
  return path.join(resolveGeneratedDir(adapterId), filename)
}
