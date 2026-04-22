import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  DOMAIN_DISCOVERY_SCHEMA_VERSION,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_SURFACE_EVIDENCE_ITEMS_PER_KIND,
  normalizeFrontendSurfaceMap,
  type FrontendSurfaceMap,
} from '../../../host-sdk/src/domain-discovery-contracts.ts'

interface PackageJson {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface ScannedFile {
  relativePath: string
  absolutePath: string
  content: string
}

export interface StaticFrontendScannerOptions {
  targetId?: string
  maxFiles?: number
  maxBytesPerFile?: number
}

const DEFAULT_MAX_FILES = 250
const DEFAULT_MAX_BYTES_PER_FILE = 120_000
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.html', '.md'])
const IGNORED_DIRS = new Set([
  '.agentic-qa',
  '.git',
  '.next',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'playwright-report',
])

const FRAMEWORK_PACKAGES: Array<{ packageName: string; frameworkName: string }> = [
  { packageName: 'vite', frameworkName: 'vite' },
  { packageName: 'next', frameworkName: 'nextjs' },
  { packageName: 'react', frameworkName: 'react' },
  { packageName: 'vue', frameworkName: 'vue' },
  { packageName: 'svelte', frameworkName: 'svelte' },
  { packageName: '@angular/core', frameworkName: 'angular' },
  { packageName: '@angular/cli', frameworkName: 'angular' },
]

export class StaticFrontendScanner {
  async scan(repoPath: string, options: StaticFrontendScannerOptions = {}): Promise<FrontendSurfaceMap> {
    return scanStaticFrontend(repoPath, options)
  }
}

export async function scanStaticFrontend(
  repoPath: string,
  options: StaticFrontendScannerOptions = {},
): Promise<FrontendSurfaceMap> {
  const packageJson = await readPackageJson(repoPath)
  const targetId = normalizeId(options.targetId ?? packageJson?.name ?? path.basename(repoPath) ?? 'frontend-target')
  const files = await listScanFiles(repoPath, {
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxBytesPerFile: options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE,
  })
  const sourceFiles = files.filter((file) => isSourceFile(file.relativePath))
  const testFiles = files.filter((file) => isTestFile(file.relativePath))
  const docsFiles = files.filter((file) => isDocFile(file.relativePath))

  const surfaceMapInput = {
    schemaVersion: DOMAIN_DISCOVERY_SCHEMA_VERSION,
    targetId,
    repositoryRootName: path.basename(repoPath),
    generatedAt: new Date(0).toISOString(),
    routes: collectRoutes(sourceFiles),
    components: collectComponents(sourceFiles),
    forms: collectForms(sourceFiles),
    buttons: collectButtons(sourceFiles),
    texts: [
      ...collectTexts(sourceFiles),
      ...collectDocSnippets(docsFiles),
    ],
    navigation: collectNavigation(sourceFiles),
    packages: collectPackageEvidence(packageJson),
    frameworks: collectFrameworkEvidence(packageJson, sourceFiles),
    tests: collectTestEvidence(testFiles),
  }

  return normalizeFrontendSurfaceMap(surfaceMapInput)
}

async function readPackageJson(repoPath: string): Promise<PackageJson | null> {
  try {
    const raw = await fs.readFile(path.join(repoPath, 'package.json'), 'utf8')
    return JSON.parse(raw) as PackageJson
  } catch {
    return null
  }
}

async function listScanFiles(
  repoPath: string,
  options: { maxFiles: number; maxBytesPerFile: number },
): Promise<ScannedFile[]> {
  const results: ScannedFile[] = []

  async function walk(currentDir: string): Promise<void> {
    if (results.length >= options.maxFiles) return
    const entries = await safeReadDir(currentDir)
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      if (results.length >= options.maxFiles) return
      if (entry.name.startsWith('.env')) continue
      const absolutePath = path.join(currentDir, entry.name)
      const relativePath = normalizePath(path.relative(repoPath, absolutePath))

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(absolutePath)
        continue
      }

      if (!entry.isFile()) continue
      if (path.basename(relativePath) === 'package.json') continue
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
      const stat = await fs.stat(absolutePath)
      if (stat.size > options.maxBytesPerFile) continue
      const content = await fs.readFile(absolutePath, 'utf8')
      results.push({ relativePath, absolutePath, content })
    }
  }

  await walk(repoPath)
  return results
}

async function safeReadDir(dirPath: string) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function collectPackageEvidence(packageJson: PackageJson | null) {
  const deps = collectDependencies(packageJson)
  return deps.slice(0, MAX_SURFACE_EVIDENCE_ITEMS_PER_KIND).map(([packageName, versionRange]) => ({
    id: makeId('pkg', packageName),
    kind: 'package' as const,
    source: { filePath: 'package.json' },
    packageName,
    versionRange,
    extractedText: packageName,
  }))
}

function collectFrameworkEvidence(packageJson: PackageJson | null, files: ScannedFile[]) {
  const deps = new Map(collectDependencies(packageJson))
  const frameworks = new Map<string, { sourcePath: string; extractedText: string }>()

  for (const framework of FRAMEWORK_PACKAGES) {
    if (deps.has(framework.packageName)) {
      frameworks.set(framework.frameworkName, {
        sourcePath: 'package.json',
        extractedText: framework.packageName,
      })
    }
  }

  if (files.some((file) => /(^|\/)src\/app\/.+\/page\.(t|j)sx?$/.test(file.relativePath))) {
    frameworks.set('nextjs', { sourcePath: 'src/app', extractedText: 'Next.js app router files' })
  }
  if (files.some((file) => file.relativePath.endsWith('.vue'))) {
    frameworks.set('vue', { sourcePath: firstMatchingPath(files, '.vue'), extractedText: 'Vue single-file component' })
  }
  if (files.some((file) => file.relativePath.endsWith('.svelte'))) {
    frameworks.set('svelte', { sourcePath: firstMatchingPath(files, '.svelte'), extractedText: 'Svelte component' })
  }

  if (frameworks.size === 0 && files.some((file) => file.relativePath.endsWith('.html'))) {
    frameworks.set('generic_frontend', { sourcePath: firstMatchingPath(files, '.html'), extractedText: 'Static HTML frontend' })
  }

  return Array.from(frameworks.entries()).slice(0, MAX_SURFACE_EVIDENCE_ITEMS_PER_KIND).map(([frameworkName, info]) => ({
    id: makeId('framework', frameworkName),
    kind: 'framework' as const,
    source: { filePath: info.sourcePath },
    frameworkName,
    extractedText: info.extractedText,
  }))
}

function collectRoutes(files: ScannedFile[]) {
  const routes: Array<Record<string, unknown>> = []

  for (const file of files) {
    const nextAppRoute = inferNextAppRoute(file.relativePath)
    if (nextAppRoute) {
      routes.push({
        id: makeId('route', nextAppRoute),
        kind: 'route',
        source: { filePath: file.relativePath },
        path: nextAppRoute,
        label: humanizeRoute(nextAppRoute),
        extractedText: `Next.js app route ${nextAppRoute}`,
      })
    }

    const nextPagesRoute = inferNextPagesRoute(file.relativePath)
    if (nextPagesRoute) {
      routes.push({
        id: makeId('route', nextPagesRoute),
        kind: 'route',
        source: { filePath: file.relativePath },
        path: nextPagesRoute,
        label: humanizeRoute(nextPagesRoute),
        extractedText: `Next.js pages route ${nextPagesRoute}`,
      })
    }

    for (const match of file.content.matchAll(/<Route\b[^>]*\bpath=["']([^"']+)["']/g)) {
      const routePath = match[1] ?? '/'
      routes.push({
        id: makeId('route', routePath),
        kind: 'route',
        source: { filePath: file.relativePath, line: lineForIndex(file.content, match.index ?? 0) },
        path: routePath,
        label: humanizeRoute(routePath),
        extractedText: `React route ${routePath}`,
      })
    }

    if (file.relativePath === 'index.html') {
      routes.push({
        id: 'route_root',
        kind: 'route',
        source: { filePath: file.relativePath },
        path: '/',
        label: 'Root',
        extractedText: 'Static root document',
      })
    }
  }

  return uniqueById(routes)
}

function collectComponents(files: ScannedFile[]) {
  const components: Array<Record<string, unknown>> = []
  for (const file of files) {
    const fileComponentName = inferComponentNameFromPath(file.relativePath)
    if (fileComponentName) {
      components.push({
        id: makeId('component', fileComponentName),
        kind: 'component',
        source: { filePath: file.relativePath },
        componentName: fileComponentName,
        extractedText: fileComponentName,
      })
    }

    for (const match of file.content.matchAll(/(?:export\s+default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
      addComponent(components, file, match[1], match.index ?? 0)
    }
    for (const match of file.content.matchAll(/(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=/g)) {
      addComponent(components, file, match[1], match.index ?? 0)
    }
  }
  return uniqueById(components)
}

function collectForms(files: ScannedFile[]) {
  const forms: Array<Record<string, unknown>> = []
  for (const file of files) {
    for (const match of file.content.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const attrs = match[1] ?? ''
      const body = match[2] ?? ''
      const actionName = extractAttribute(attrs, 'onSubmit')?.replace(/[{}]/g, '').trim()
      const fields = extractFieldLabels(body)
      const line = lineForIndex(file.content, match.index ?? 0)
      forms.push({
        id: makeId('form', file.relativePath, line),
        kind: 'form',
        source: { filePath: file.relativePath, line },
        fields,
        actionName: actionName || undefined,
        extractedText: sanitizeText(body),
      })
    }
  }
  return uniqueById(forms)
}

function collectButtons(files: ScannedFile[]) {
  const buttons: Array<Record<string, unknown>> = []
  for (const file of files) {
    for (const match of file.content.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const attrs = match[1] ?? ''
      const body = match[2] ?? ''
      const text = sanitizeText(extractAttribute(attrs, 'aria-label') ?? body)
      if (!text) continue
      const line = lineForIndex(file.content, match.index ?? 0)
      buttons.push({
        id: makeId('button', file.relativePath, line, text),
        kind: 'button',
        source: { filePath: file.relativePath, line },
        buttonText: text,
        extractedText: text,
      })
    }

    for (const match of file.content.matchAll(/<input\b([^>]*\btype=["']submit["'][^>]*)>/gi)) {
      const attrs = match[1] ?? ''
      const text = sanitizeText(extractAttribute(attrs, 'value') ?? 'Submit')
      const line = lineForIndex(file.content, match.index ?? 0)
      buttons.push({
        id: makeId('button', file.relativePath, line, text),
        kind: 'button',
        source: { filePath: file.relativePath, line },
        buttonText: text,
        extractedText: text,
      })
    }
  }
  return uniqueById(buttons)
}

function collectTexts(files: ScannedFile[]) {
  const texts: Array<Record<string, unknown>> = []
  for (const file of files) {
    for (const match of file.content.matchAll(/<(h[1-3]|label)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const tag = (match[1] ?? '').toLowerCase()
      const text = sanitizeText(match[2] ?? '')
      if (!text) continue
      const line = lineForIndex(file.content, match.index ?? 0)
      texts.push({
        id: makeId('text', file.relativePath, line, text),
        kind: 'text',
        source: { filePath: file.relativePath, line },
        textRole: tag === 'label' ? 'label' : 'heading',
        extractedText: text,
      })
    }
  }
  return uniqueById(texts)
}

function collectDocSnippets(files: ScannedFile[]) {
  const snippets: Array<Record<string, unknown>> = []
  for (const file of files) {
    const heading = file.content.match(/^#\s+(.+)$/m)
    const text = sanitizeText(heading?.[1] ?? file.content.split('\n').slice(0, 3).join(' '))
    if (!text) continue
    snippets.push({
      id: makeId('text_doc', file.relativePath),
      kind: 'text',
      source: { filePath: file.relativePath },
      textRole: 'body',
      extractedText: text,
    })
  }
  return uniqueById(snippets)
}

function collectNavigation(files: ScannedFile[]) {
  const navigation: Array<Record<string, unknown>> = []
  for (const file of files) {
    for (const match of file.content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      addNavigation(navigation, file, match[1], match[2], match.index ?? 0)
    }
    for (const match of file.content.matchAll(/<Link\b([^>]*)>([\s\S]*?)<\/Link>/gi)) {
      addNavigation(navigation, file, match[1], match[2], match.index ?? 0)
    }
  }
  return uniqueById(navigation)
}

function collectTestEvidence(files: ScannedFile[]) {
  const tests: Array<Record<string, unknown>> = []
  for (const file of files) {
    for (const match of file.content.matchAll(/\b(?:test|it|describe)\s*\(\s*["'`]([^"'`]{1,240})["'`]/g)) {
      const testName = sanitizeText(match[1] ?? '')
      if (!testName) continue
      const line = lineForIndex(file.content, match.index ?? 0)
      tests.push({
        id: makeId('test', file.relativePath, line, testName),
        kind: 'test',
        source: { filePath: file.relativePath, line },
        testName,
        tool: inferTestTool(file.relativePath, file.content),
        extractedText: testName,
      })
    }
  }
  return uniqueById(tests)
}

function addComponent(components: Array<Record<string, unknown>>, file: ScannedFile, name: string | undefined, index: number) {
  if (!name) return
  components.push({
    id: makeId('component', name),
    kind: 'component',
    source: { filePath: file.relativePath, line: lineForIndex(file.content, index) },
    componentName: name,
    extractedText: name,
  })
}

function addNavigation(
  navigation: Array<Record<string, unknown>>,
  file: ScannedFile,
  attrs: string | undefined,
  body: string | undefined,
  index: number,
) {
  const targetPath = extractAttribute(attrs ?? '', 'href') ?? extractAttribute(attrs ?? '', 'to')
  const text = sanitizeText(body ?? targetPath ?? '')
  if (!text && !targetPath) return
  const line = lineForIndex(file.content, index)
  navigation.push({
    id: makeId('nav', file.relativePath, line, targetPath ?? text),
    kind: 'navigation',
    source: { filePath: file.relativePath, line },
    targetPath: targetPath || undefined,
    extractedText: text || targetPath,
  })
}

function collectDependencies(packageJson: PackageJson | null): Array<[string, string]> {
  return Object.entries({
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  }).sort(([a], [b]) => a.localeCompare(b))
}

function inferNextAppRoute(relativePath: string): string | null {
  const match = relativePath.match(/^(?:src\/)?app\/(.+)\/page\.(?:t|j)sx?$/)
  if (!match?.[1]) return null
  return normalizeRoutePath(match[1])
}

function inferNextPagesRoute(relativePath: string): string | null {
  const match = relativePath.match(/^(?:src\/)?pages\/(.+)\.(?:t|j)sx?$/)
  const rawRoute = match?.[1]
  if (!rawRoute || rawRoute.startsWith('api/') || rawRoute.startsWith('_')) return null
  return normalizeRoutePath(rawRoute.replace(/\/index$/, ''))
}

function normalizeRoutePath(value: string) {
  const segments = value
    .split('/')
    .filter(Boolean)
    .filter((segment) => !segment.startsWith('(') || !segment.endsWith(')'))
    .map((segment) => segment.replace(/\[([^\]]+)\]/g, ':$1'))
  return segments.length === 0 ? '/' : '/' + segments.join('/')
}

function inferComponentNameFromPath(relativePath: string): string | null {
  const base = path.basename(relativePath, path.extname(relativePath))
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(base)) return null
  return base
}

function extractAttribute(attrs: string, name: string): string | null {
  const regex = new RegExp(`${name}=["']([^"']+)["']|${name}=\\{([^}]+)\\}`, 'i')
  const match = attrs.match(regex)
  return match?.[1] ?? match?.[2] ?? null
}

function extractFieldLabels(body: string) {
  const labels = new Set<string>()
  for (const match of body.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attrs = match[2] ?? ''
    const label = extractAttribute(attrs, 'name')
      ?? extractAttribute(attrs, 'placeholder')
      ?? extractAttribute(attrs, 'aria-label')
    if (label) labels.add(sanitizeText(label))
  }
  for (const match of body.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)) {
    const label = sanitizeText(match[1] ?? '')
    if (label) labels.add(label)
  }
  return Array.from(labels).filter(Boolean).slice(0, 40)
}

function sanitizeText(value: string) {
  return stripTags(value)
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARS)
}

function stripTags(value: string) {
  return value
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function lineForIndex(content: string, index: number) {
  return content.slice(0, index).split('\n').length
}

function humanizeRoute(routePath: string) {
  if (routePath === '/') return 'Root'
  return routePath
    .replace(/^\//, '')
    .replace(/[:/_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item'
}

function makeId(prefix: string, ...parts: Array<string | number | undefined | null>) {
  return normalizeId([prefix, ...parts.filter((part) => part !== undefined && part !== null)].join('_')).slice(0, 120)
}

function normalizePath(value: string) {
  return value.split(path.sep).join('/')
}

function uniqueById<T extends Record<string, unknown>>(items: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const id = String(item['id'])
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(item)
  }
  return unique.slice(0, MAX_SURFACE_EVIDENCE_ITEMS_PER_KIND)
}

function isSourceFile(relativePath: string) {
  if (isDocFile(relativePath)) return false
  return /\.(ts|tsx|js|jsx|vue|svelte|html)$/.test(relativePath)
}

function isTestFile(relativePath: string) {
  return /(^|\/)(tests?|__tests__|e2e)\//.test(relativePath)
    || /\.(spec|test|cy)\.(ts|tsx|js|jsx)$/.test(relativePath)
}

function isDocFile(relativePath: string) {
  return /(^|\/)(readme|docs\/.+)\.md$/i.test(relativePath)
}

function inferTestTool(relativePath: string, content: string) {
  if (/playwright/i.test(content) || /playwright/i.test(relativePath)) return 'playwright'
  if (/cypress|cy\./i.test(content) || /\.cy\./.test(relativePath)) return 'cypress'
  if (/vitest|vi\./i.test(content)) return 'vitest'
  return 'unknown'
}

function firstMatchingPath(files: ScannedFile[], extension: string) {
  return files.find((file) => file.relativePath.endsWith(extension))?.relativePath ?? extension
}
