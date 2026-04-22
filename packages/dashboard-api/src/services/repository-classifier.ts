import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RepositoryClassification, RepositoryKind } from '../../../host-sdk/src/contracts.ts'

type ScoreMap = Record<RepositoryKind, number>

const IGNORED_DIRS = new Set([
  '.agentic-qa',
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
])

export async function classifyRepository(repoPath: string): Promise<RepositoryClassification> {
  const [packageJson, pyproject, cargoToml, goMod, files] = await Promise.all([
    readJson(path.join(repoPath, 'package.json')),
    readText(path.join(repoPath, 'pyproject.toml')),
    readText(path.join(repoPath, 'Cargo.toml')),
    readText(path.join(repoPath, 'go.mod')),
    listRelevantFiles(repoPath),
  ])

  const relativeFiles = files.map((filePath) => path.relative(repoPath, filePath).replace(/\\/g, '/'))
  const scores: ScoreMap = {
    frontend: 0,
    backend_api: 0,
    cli: 0,
    library: 0,
    monorepo: 0,
    unknown: 0,
  }
  const evidence: string[] = []
  const runtimeHints: string[] = []
  const frameworks = new Set<string>()

  const deps = {
    ...recordValue(packageJson?.['dependencies']),
    ...recordValue(packageJson?.['devDependencies']),
  }
  const scripts = recordValue(packageJson?.['scripts'])

  const add = (kind: RepositoryKind, points: number, reason: string) => {
    scores[kind] += points
    evidence.push(reason)
  }

  if (packageJson?.['workspaces'] || await pathExists(path.join(repoPath, 'pnpm-workspace.yaml'))) {
    add('monorepo', 3, 'monorepo workspace metadata detected')
  }
  if (await pathExists(path.join(repoPath, 'turbo.json'))) add('monorepo', 2, 'turbo.json detected')
  if (await pathExists(path.join(repoPath, 'nx.json'))) add('monorepo', 2, 'nx.json detected')

  for (const [dep, framework] of [
    ['next', 'nextjs'],
    ['vite', 'vite'],
    ['react', 'react'],
    ['vue', 'vue'],
    ['svelte', 'svelte'],
    ['@angular/core', 'angular'],
  ] as const) {
    if (dep in deps) {
      add('frontend', dep === 'react' ? 2 : 4, `frontend dependency detected: ${dep}`)
      frameworks.add(framework)
    }
  }

  if (relativeFiles.some((filePath) => filePath === 'index.html' || /(^|\/)(main|App)\.[jt]sx?$/.test(filePath))) {
    add('frontend', 3, 'frontend entrypoint detected')
  }
  if (relativeFiles.some((filePath) => /(^|\/)(app|pages)\/.*\.(tsx|jsx|vue|svelte)$/.test(filePath))) {
    add('frontend', 2, 'frontend route/component tree detected')
  }

  for (const [dep, framework] of [
    ['express', 'express'],
    ['fastify', 'fastify'],
    ['koa', 'koa'],
    ['hono', 'hono'],
    ['elysia', 'elysia'],
    ['@nestjs/core', 'nestjs'],
  ] as const) {
    if (dep in deps) {
      add('backend_api', 4, `backend API dependency detected: ${dep}`)
      frameworks.add(framework)
    }
  }
  if (relativeFiles.some((filePath) => /(^|\/)(server|app|routes|router|api)\.(ts|tsx|js|mjs|cjs|py|go|rs)$/.test(filePath))) {
    add('backend_api', 3, 'backend route/server file detected')
  }
  if (Object.keys(scripts).some((script) => /^(serve|server|start:api|dev:api)$/.test(script))) {
    add('backend_api', 2, 'backend API script detected')
  }

  if (packageJson?.['bin']) add('cli', 5, 'package.json bin entry detected')
  for (const dep of ['commander', 'yargs', '@oclif/core', 'clipanion', 'cac']) {
    if (dep in deps) add('cli', 3, `CLI dependency detected: ${dep}`)
  }
  if (relativeFiles.some((filePath) => /(^|\/)(cli|command|commands|bin)\/|(^|\/)(cli|bin)\.(ts|js|mjs|py|go|rs)$/.test(filePath))) {
    add('cli', 3, 'CLI entrypoint detected')
  }

  if (packageJson?.['exports'] || packageJson?.['main'] || packageJson?.['types']) {
    add('library', 2, 'package export metadata detected')
  }
  if (pyproject && /\[project\]|\[tool\.poetry\]/.test(pyproject)) add('library', 2, 'python package metadata detected')
  if (cargoToml && /\[lib\]/.test(cargoToml)) add('library', 3, 'rust library metadata detected')
  if (goMod) add('library', 1, 'go module metadata detected')
  if (relativeFiles.some((filePath) => /(^|\/)(src\/index|lib\/index)\.(ts|js|mjs|py|go|rs)$/.test(filePath))) {
    add('library', 2, 'library index entrypoint detected')
  }

  for (const [name, command] of Object.entries(scripts)) {
    runtimeHints.push(`script:${name}=${String(command)}`)
  }

  const ranked = (Object.entries(scores) as Array<[RepositoryKind, number]>)
    .filter(([kind]) => kind !== 'unknown')
    .sort((a, b) => b[1] - a[1])
  const [topKind, topScore] = ranked[0] ?? ['unknown', 0]
  const selectedKind = topScore > 0
    ? topKind === 'monorepo' && (ranked[1]?.[1] ?? 0) > 0
      ? ranked[1]![0]
      : topKind
    : 'unknown'
  const secondaryKinds = ranked
    .filter(([kind, score]) => score > 0 && kind !== selectedKind)
    .map(([kind]) => kind)

  if (selectedKind === 'unknown') {
    evidence.push('no supported runtime signature detected')
  }

  return {
    kind: selectedKind,
    secondaryKinds,
    language: detectPrimaryLanguage(relativeFiles, { packageJson, pyproject, cargoToml, goMod }),
    frameworks: Array.from(frameworks),
    packageManager: await detectPackageManager(repoPath),
    confidence: normalizeConfidence(topScore),
    evidence: Array.from(new Set(evidence)).slice(0, 20),
    runtimeHints: runtimeHints.slice(0, 20),
  }
}

async function listRelevantFiles(repoPath: string): Promise<string[]> {
  const files: string[] = []
  await walk(repoPath, files, repoPath)
  return files.slice(0, 500)
}

async function walk(dir: string, files: string[], root: string): Promise<void> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const depth = path.relative(root, entryPath).split(path.sep).filter(Boolean).length
      if (depth > 5) continue
      await walk(entryPath, files, root)
      continue
    }
    if (!entry.isFile()) continue
    if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|html|css|py|go|rs|toml|json|md|yaml|yml)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }
}

async function detectPackageManager(repoPath: string): Promise<string | null> {
  if (await pathExists(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await pathExists(path.join(repoPath, 'package-lock.json'))) return 'npm'
  if (await pathExists(path.join(repoPath, 'yarn.lock'))) return 'yarn'
  if (await pathExists(path.join(repoPath, 'bun.lockb')) || await pathExists(path.join(repoPath, 'bun.lock'))) return 'bun'
  if (await pathExists(path.join(repoPath, 'uv.lock'))) return 'uv'
  if (await pathExists(path.join(repoPath, 'poetry.lock'))) return 'poetry'
  if (await pathExists(path.join(repoPath, 'Cargo.lock'))) return 'cargo'
  if (await pathExists(path.join(repoPath, 'go.sum'))) return 'go'
  return null
}

function detectPrimaryLanguage(
  relativeFiles: string[],
  metadata: {
    packageJson: Record<string, unknown> | null
    pyproject: string | null
    cargoToml: string | null
    goMod: string | null
  },
): string | null {
  if (metadata.packageJson) {
    if (relativeFiles.some((filePath) => /\.(ts|tsx)$/.test(filePath))) return 'typescript'
    return 'javascript'
  }
  if (metadata.pyproject || relativeFiles.some((filePath) => filePath.endsWith('.py'))) return 'python'
  if (metadata.cargoToml || relativeFiles.some((filePath) => filePath.endsWith('.rs'))) return 'rust'
  if (metadata.goMod || relativeFiles.some((filePath) => filePath.endsWith('.go'))) return 'go'
  return null
}

function normalizeConfidence(score: number): number {
  if (score <= 0) return 0.2
  return Math.max(0.35, Math.min(0.95, score / 10))
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
