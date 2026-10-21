import { promises as fs } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type {
  BootstrapDraft,
  DiscoveryReport,
  DiscoveredSurface,
  GeneratedPersonaDraft,
  GeneratedScenarioDraft,
} from '../../../host-sdk/src/contracts.ts'
import {
  CODE_GRAPH_SCHEMA_VERSION,
  CodeGraphSchema,
  type CodeGraph,
  type CodeGraphEdge,
  type CodeGraphEdgeType,
  type CodeGraphNode,
  type CodeGraphNodeType,
} from '../../../host-sdk/src/code-graph-contracts.ts'
import type {
  CapabilityCandidate,
  DomainDiscoveryBundle,
  EvidenceRef,
  FrontendEvidenceKind,
  FrontendSurfaceMap,
  SourceLocation,
} from '../../../host-sdk/src/domain-discovery-contracts.ts'

interface BuildCodeGraphInput {
  targetId: string
  report: DiscoveryReport
  draft: BootstrapDraft
  repoPath?: string
}

type MutableGraphNode = Omit<CodeGraphNode, 'metadata'> & {
  metadata?: Record<string, unknown>
}

type MutableGraphEdge = Omit<CodeGraphEdge, 'metadata'> & {
  metadata?: Record<string, unknown>
}

interface SourceGraphFile {
  relativePath: string
  content: string
}

interface ImportEvidence {
  id: string
  specifier: string
  source: SourceLocation
  targetFilePath: string | null
  externalPackage: string | null
  label: string
  localBindings: string[]
}

interface FunctionEvidence {
  id: string
  name: string
  source: SourceLocation
  label: string
  kind: 'function' | 'handler' | 'service'
}

interface FunctionCallEvidence {
  id: string
  source: SourceLocation
  callerFunctionName: string
  calleeName: string
  targetFilePath: string | null
  targetLabel?: string
  externalPackage?: string | null
  callCategory?: 'data_access' | 'external_client'
  baseIdentifier?: string
  propertyPath?: string[]
}

interface EndpointEvidence {
  id: string
  method: string
  routePath: string
  source: SourceLocation
  label: string
  framework: string
  routerName?: string
  handlerName?: string
  handlerSource?: SourceLocation
  enclosingFunctionName?: string
  mountChain?: string[]
}

interface HttpCallEvidence {
  id: string
  method: string
  url: string
  normalizedPath: string | null
  source: SourceLocation
  label: string
  client: string
  enclosingFunctionName?: string
}

interface UiEventHandlerEvidence {
  id: string
  eventName: 'onClick' | 'onSubmit'
  surfaceKind: 'button' | 'form'
  source: SourceLocation
  handlerNames: string[]
  enclosingFunctionName?: string
}

interface RouteMountEvidence {
  id: string
  source: SourceLocation
  prefix: string
  routerIdentifier: string
  targetFilePath: string | null
  enclosingFunctionName?: string
}

interface SourceGraphEvidence {
  files: SourceGraphFile[]
  imports: ImportEvidence[]
  functions: FunctionEvidence[]
  functionCalls: FunctionCallEvidence[]
  endpoints: EndpointEvidence[]
  httpCalls: HttpCallEvidence[]
  uiEventHandlers: UiEventHandlerEvidence[]
  routeMounts: RouteMountEvidence[]
}

const EVIDENCE_KIND_TO_NODE_TYPE: Record<FrontendEvidenceKind, CodeGraphNodeType> = {
  route: 'route',
  component: 'component',
  form: 'form',
  button: 'button',
  text: 'text',
  navigation: 'navigation',
  package: 'package',
  framework: 'framework',
  test: 'test',
}

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
}

function normalizePath(value: string) {
  return value.split(path.sep).join('/')
}

function lineForIndex(content: string, index: number) {
  return content.slice(0, index).split('\n').length
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

function graphId(...segments: string[]) {
  return segments.map((segment) => normalizeId(segment).slice(0, 70)).join(':').slice(0, 200)
}

function edgeId(type: CodeGraphEdgeType, from: string, to: string) {
  return graphId('edge', type, from, to).slice(0, 240)
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + '...' : value
}

function toCamelCase(value: string) {
  return normalizeId(value).replace(/_+([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

function tokenizeGraphText(value: unknown): Set<string> {
  if (value === null || value === undefined) return new Set()
  const raw = Array.isArray(value) ? value.join(' ') : String(value)
  const expanded = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_/:-]+/g, ' ')
    .toLowerCase()
  const stopWords = new Set(['api', 'http', 'https', 'www', 'com', 'the', 'and', 'with', 'primary'])
  return new Set(expanded
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .map((token) => token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token))
}

function overlapScore(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0
  let overlap = 0
  for (const token of left) {
    if (right.has(token)) overlap += 1
  }
  return overlap / Math.min(left.size, right.size)
}

function addNode(nodes: Map<string, CodeGraphNode>, node: MutableGraphNode) {
  const existing = nodes.get(node.id)
  if (!existing) {
    nodes.set(node.id, {
      ...node,
      label: truncate(node.label, 300),
      metadata: node.metadata ?? {},
    })
    return node.id
  }

  const confidence = existing.confidence === undefined
    ? node.confidence
    : node.confidence === undefined
      ? existing.confidence
      : Math.max(existing.confidence, node.confidence)

  nodes.set(node.id, {
    ...existing,
    confidence,
    source: existing.source ?? node.source,
    metadata: {
      ...existing.metadata,
      ...(node.metadata ?? {}),
    },
  })
  return node.id
}

function updateNodeMetadata(nodes: Map<string, CodeGraphNode>, id: string, metadata: Record<string, unknown>) {
  const existing = nodes.get(id)
  if (!existing) return
  nodes.set(id, {
    ...existing,
    metadata: {
      ...existing.metadata,
      ...metadata,
    },
  })
}

function addEdge(edges: Map<string, CodeGraphEdge>, edge: MutableGraphEdge) {
  if (edge.from === edge.to) return
  const id = edge.id || edgeId(edge.type, edge.from, edge.to)
  if (edges.has(id)) return
  edges.set(id, {
    ...edge,
    id,
    label: edge.label ? truncate(edge.label, 240) : undefined,
    metadata: edge.metadata ?? {},
  })
}

function surfaceNodeType(surface: DiscoveredSurface): CodeGraphNodeType {
  if (surface.kind === 'route') return 'route'
  return 'surface'
}

function evidenceLabel(kind: FrontendEvidenceKind, item: Record<string, unknown>) {
  if (kind === 'route') return String(item.path ?? item.label ?? item.id)
  if (kind === 'component') return String(item.componentName ?? item.label ?? item.id)
  if (kind === 'form') return String(item.actionName ?? item.label ?? item.id)
  if (kind === 'button') return String(item.buttonText ?? item.label ?? item.id)
  if (kind === 'text') return String(item.label ?? item.extractedText ?? item.id)
  if (kind === 'navigation') return String(item.targetPath ?? item.label ?? item.id)
  if (kind === 'package') return String(item.packageName ?? item.label ?? item.id)
  if (kind === 'framework') return String(item.frameworkName ?? item.label ?? item.id)
  return String(item.testName ?? item.label ?? item.id)
}

function evidenceSource(item: Record<string, unknown>): SourceLocation | undefined {
  const source = item.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined
  return source as SourceLocation
}

async function scanSourceGraph(repoPath: string | undefined): Promise<SourceGraphEvidence> {
  if (!repoPath) return { files: [], imports: [], functions: [], functionCalls: [], endpoints: [], httpCalls: [], uiEventHandlers: [], routeMounts: [] }
  const files = await listSourceGraphFiles(repoPath)
  const filePathSet = new Set(files.map((file) => file.relativePath))
  const imports: ImportEvidence[] = []
  const functions: FunctionEvidence[] = []
  const functionCalls: FunctionCallEvidence[] = []
  const endpoints: EndpointEvidence[] = []
  const httpCalls: HttpCallEvidence[] = []
  const uiEventHandlers: UiEventHandlerEvidence[] = []
  const routeMounts: RouteMountEvidence[] = []

  for (const file of files) {
    const astEvidence = collectAstSourceEvidence(file, filePathSet)
    imports.push(...astEvidence.imports)
    functions.push(...astEvidence.functions)
    functionCalls.push(...astEvidence.functionCalls)
    endpoints.push(...astEvidence.endpoints)
    httpCalls.push(...astEvidence.httpCalls)
    uiEventHandlers.push(...astEvidence.uiEventHandlers)
    routeMounts.push(...astEvidence.routeMounts)
    endpoints.push(...collectEndpointEvidence(file))
    httpCalls.push(...collectHttpCallEvidence(file))
  }

  endpoints.push(...composeMountedEndpoints({
    imports: uniqueById(imports),
    endpoints: uniqueById(endpoints),
    routeMounts: uniqueById(routeMounts),
  }))

  return {
    files,
    imports: uniqueById(imports).slice(0, 160),
    functions: uniqueById(functions).slice(0, 200),
    functionCalls: uniqueById(functionCalls).slice(0, 240),
    endpoints: uniqueById(endpoints).slice(0, 80),
    httpCalls: uniqueById(httpCalls).slice(0, 80),
    uiEventHandlers: uniqueById(uiEventHandlers).slice(0, 120),
    routeMounts: uniqueById(routeMounts).slice(0, 80),
  }
}

async function listSourceGraphFiles(repoPath: string): Promise<SourceGraphFile[]> {
  const results: SourceGraphFile[] = []
  const ignoredDirs = new Set([
    '.agentic-qa',
    '.git',
    '.next',
    'coverage',
    'dist',
    'build',
    'node_modules',
    'playwright-report',
  ])
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'])

  async function walk(currentDir: string): Promise<void> {
    if (results.length >= 350) return
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (results.length >= 350) return
      if (entry.name.startsWith('.env')) continue
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) await walk(absolutePath)
        continue
      }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue
      let stat
      try {
        stat = await fs.stat(absolutePath)
      } catch {
        continue
      }
      if (stat.size > 160_000) continue
      try {
        const content = await fs.readFile(absolutePath, 'utf8')
        results.push({
          relativePath: normalizePath(path.relative(repoPath, absolutePath)),
          content,
        })
      } catch {
        // Skip unreadable files.
      }
    }
  }

  await walk(repoPath)
  return results
}

function collectAstSourceEvidence(file: SourceGraphFile, filePathSet: Set<string>): {
  imports: ImportEvidence[]
  functions: FunctionEvidence[]
  functionCalls: FunctionCallEvidence[]
  endpoints: EndpointEvidence[]
  httpCalls: HttpCallEvidence[]
  uiEventHandlers: UiEventHandlerEvidence[]
  routeMounts: RouteMountEvidence[]
} {
  const imports: ImportEvidence[] = []
  const functions: FunctionEvidence[] = []
  const functionCalls: FunctionCallEvidence[] = []
  const endpoints: EndpointEvidence[] = []
  const httpCalls: HttpCallEvidence[] = []
  const uiEventHandlers: UiEventHandlerEvidence[] = []
  const routeMounts: RouteMountEvidence[] = []
  if (!/\.[cm]?[jt]sx?$/.test(file.relativePath)) return { imports, functions, functionCalls, endpoints, httpCalls, uiEventHandlers, routeMounts }

  const sourceFile = ts.createSourceFile(
    file.relativePath,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(file.relativePath),
  )
  const functionNameByNode = new Map<ts.Node, string>()
  const functionNodeByName = new Map<string, ts.Node>()
  const routerInstanceNames = new Set(['app', 'router', 'fastify', 'server'])

  function sourceForNode(node: ts.Node): SourceLocation {
    return {
      filePath: file.relativePath,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    }
  }

  function inferredFunctionKind(filePath: string, currentKind: FunctionEvidence['kind'] = 'function'): FunctionEvidence['kind'] {
    if (currentKind !== 'function') return currentKind
    if (/\/(services|clients|repositories|data)\//i.test(filePath)) return 'service'
    return currentKind
  }

  function registerFunction(node: ts.Node, name: string, kind: FunctionEvidence['kind'] = 'function') {
    if (!name) return
    const resolvedKind = inferredFunctionKind(file.relativePath, kind)
    functionNameByNode.set(node, name)
    functionNodeByName.set(name, node)
    functions.push({
      id: graphId(resolvedKind, file.relativePath, name, String(sourceForNode(node).line ?? 1)),
      name,
      source: sourceForNode(node),
      label: name,
      kind: resolvedKind,
    })
  }

  function registerObjectLiteralMethods(node: ts.ObjectLiteralExpression) {
    for (const property of node.properties) {
      if (ts.isMethodDeclaration(property)) {
        const methodName = propertyNameText(property.name)
        if (methodName) registerFunction(property, methodName)
        continue
      }
      if (!ts.isPropertyAssignment(property)) continue
      const methodName = propertyNameText(property.name)
      if (!methodName) continue
      if (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer)) {
        registerFunction(property.initializer, methodName)
      }
    }
  }

  function discoverDeclarations(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      const targetFilePath = resolveRelativeImport(file.relativePath, specifier, filePathSet)
      imports.push({
        id: graphId('import', file.relativePath, specifier, String(sourceForNode(node).line ?? 1)),
        specifier,
        source: sourceForNode(node),
        targetFilePath,
        externalPackage: targetFilePath ? null : externalPackageName(specifier),
        label: specifier,
        localBindings: importLocalBindings(node.importClause),
      })
    }

    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      registerFunction(node, node.name.text)
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isRouterInitializer(node.initializer)) {
        routerInstanceNames.add(node.name.text)
      }
      if (ts.isObjectLiteralExpression(node.initializer)) {
        registerObjectLiteralMethods(node.initializer)
      }
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        registerFunction(node.initializer, node.name.text)
      }
    } else if (ts.isMethodDeclaration(node)) {
      const methodName = propertyNameText(node.name)
      if (methodName) registerFunction(node, methodName)
    } else if (ts.isExportAssignment(node) && ts.isObjectLiteralExpression(node.expression)) {
      registerObjectLiteralMethods(node.expression)
    }

    ts.forEachChild(node, discoverDeclarations)
  }

  function enclosingFunctionName(node: ts.Node): string | undefined {
    let current: ts.Node | undefined = node
    while (current) {
      const name = functionNameByNode.get(current)
      if (name) return name
      current = current.parent
    }
    return undefined
  }

  function discoverCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const endpoint = endpointFromAstCall(file, sourceFile, node, enclosingFunctionName(node), functionNodeByName, routerInstanceNames)
      if (endpoint) {
        endpoints.push(endpoint)
        if (endpoint.handlerName && endpoint.handlerSource) {
          functions.push({
            id: graphId('handler', file.relativePath, endpoint.handlerName, String(endpoint.handlerSource.line ?? 1)),
            name: endpoint.handlerName,
            source: endpoint.handlerSource,
            label: endpoint.handlerName,
            kind: 'handler',
          })
        }
      }
      const httpCall = httpCallFromAstCall(file, sourceFile, node, enclosingFunctionName(node))
      if (httpCall) httpCalls.push(httpCall)
      const routeMount = routeMountFromAstCall(file, sourceFile, node, imports, enclosingFunctionName(node), routerInstanceNames)
      if (routeMount) routeMounts.push(routeMount)
      const functionCall = functionCallFromAstCall(file, sourceFile, node, imports, enclosingFunctionName(node), routerInstanceNames)
      if (functionCall) functionCalls.push(functionCall)
    }

    ts.forEachChild(node, discoverCalls)
  }

  function discoverUiEventHandlers(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = jsxTagNameText(node.tagName)
      const surfaceKind = tagName === 'button'
        ? 'button'
        : tagName === 'form'
          ? 'form'
          : null
      if (surfaceKind) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue
          const attributeName = ts.isIdentifier(attribute.name) ? attribute.name.text : null
          const eventName = attributeName === 'onClick' || attributeName === 'onSubmit'
            ? attributeName
            : null
          if (!eventName) continue
          const initializer = attribute.initializer
          if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) continue
          const handlerNames = extractUiHandlerNames(initializer.expression)
          if (handlerNames.length === 0) continue
          const source = sourceForNode(node)
          uiEventHandlers.push({
            id: graphId('ui_event', file.relativePath, surfaceKind, eventName, String(source.line ?? 1), handlerNames.join('_')),
            eventName,
            surfaceKind,
            source,
            handlerNames,
            enclosingFunctionName: enclosingFunctionName(node),
          })
        }
      }
    }

    ts.forEachChild(node, discoverUiEventHandlers)
  }

  discoverDeclarations(sourceFile)
  discoverCalls(sourceFile)
  discoverUiEventHandlers(sourceFile)

  return { imports, functions, functionCalls, endpoints, httpCalls, uiEventHandlers, routeMounts }
}

function jsxTagNameText(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isPropertyAccessExpression(name)) return name.name.text
  return null
}

function extractUiHandlerNames(expression: ts.Expression): string[] {
  const names = new Set<string>()

  function visit(node: ts.Node): void {
    if (
      ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node)
      || ts.isAwaitExpression(node)
      || ts.isVoidExpression(node)
    ) {
      visit(node.expression)
      return
    }

    if (ts.isIdentifier(node)) {
      names.add(node.text)
      return
    }

    if (ts.isPropertyAccessExpression(node)) {
      names.add(node.name.text)
      visit(node.expression)
      return
    }

    if (ts.isCallExpression(node)) {
      const targetName = callTargetName(node.expression)
      if (targetName) names.add(targetName)
      ts.forEachChild(node, visit)
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(expression)

  return [...names]
    .filter((name) => !isUiLocalOnlyHandlerName(name))
    .slice(0, 6)
}

function callTargetName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

function isUiLocalOnlyHandlerName(name: string) {
  return /^(set[A-Z]|console|preventDefault|stopPropagation|then|catch|finally)$/i.test(name)
}

function scriptKindForPath(relativePath: string): ts.ScriptKind {
  const ext = path.extname(relativePath).toLowerCase()
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function stringLiteralText(node: ts.Expression | undefined): string | null {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function objectLiteralStringProperty(objectLiteral: ts.ObjectLiteralExpression | undefined, propertyName: string): string | null {
  if (!objectLiteral) return null
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = propertyNameText(property.name)
    if (name !== propertyName) continue
    return stringLiteralText(property.initializer)
  }
  return null
}

function importLocalBindings(importClause: ts.ImportClause | undefined) {
  const bindings: string[] = []
  if (!importClause) return bindings
  if (importClause.name?.text) bindings.push(importClause.name.text)
  const namedBindings = importClause.namedBindings
  if (!namedBindings) return bindings
  if (ts.isNamespaceImport(namedBindings)) {
    bindings.push(namedBindings.name.text)
    return bindings
  }
  for (const element of namedBindings.elements) {
    bindings.push((element.name?.text ?? element.propertyName?.text ?? '').trim())
  }
  return bindings.filter(Boolean)
}

function isRouterInitializer(expression: ts.Expression) {
  if (!ts.isCallExpression(expression)) return false
  if (ts.isIdentifier(expression.expression) && expression.expression.text === 'Router') return true
  if (!ts.isPropertyAccessExpression(expression.expression)) return false
  return ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === 'express'
    && expression.expression.name.text === 'Router'
}

function callPropertyName(expression: ts.Expression): { objectName: string | null; propertyName: string | null } {
  if (!ts.isPropertyAccessExpression(expression)) return { objectName: null, propertyName: null }
  const propertyName = expression.name.text
  const objectName = ts.isIdentifier(expression.expression) ? expression.expression.text : null
  return { objectName, propertyName }
}

function callTargetDescriptor(expression: ts.Expression): {
  baseIdentifier: string | null
  propertyPath: string[]
  fullName: string | null
} {
  if (ts.isIdentifier(expression)) {
    return {
      baseIdentifier: expression.text,
      propertyPath: [],
      fullName: expression.text,
    }
  }
  if (!ts.isPropertyAccessExpression(expression)) {
    return {
      baseIdentifier: null,
      propertyPath: [],
      fullName: null,
    }
  }

  const propertyPath: string[] = []
  let current: ts.Expression = expression
  while (ts.isPropertyAccessExpression(current)) {
    propertyPath.unshift(current.name.text)
    current = current.expression
  }

  if (!ts.isIdentifier(current)) {
    return {
      baseIdentifier: null,
      propertyPath,
      fullName: propertyPath.length > 0 ? propertyPath.join('.') : null,
    }
  }

  return {
    baseIdentifier: current.text,
    propertyPath,
    fullName: [current.text, ...propertyPath].join('.'),
  }
}

function isKnownDataPackage(packageName: string | null | undefined) {
  if (!packageName) return false
  return [
    '@prisma/client',
    '@supabase/supabase-js',
    'drizzle-orm',
    'kysely',
    'knex',
    'mongoose',
    'pg',
    'mysql2',
    'better-sqlite3',
    'sqlite3',
    'sequelize',
    'typeorm',
  ].includes(packageName)
}

function looksLikeDataAccessTarget(input: {
  baseIdentifier: string | null
  propertyPath: string[]
  externalPackage: string | null
}) {
  if (isKnownDataPackage(input.externalPackage)) return true
  const identifier = (input.baseIdentifier ?? '').toLowerCase()
  const fullPath = input.propertyPath.map((segment) => segment.toLowerCase())
  if (/(^|_)(db|database|repo|repository|model|models|collection|collections|prisma|sequelize|typeorm|knex|mongoose|supabase)(_|$)/i.test(identifier)) {
    return true
  }
  const dataVerbs = new Set([
    'find',
    'findall',
    'findmany',
    'findfirst',
    'findunique',
    'select',
    'insert',
    'update',
    'delete',
    'upsert',
    'create',
    'save',
    'query',
    'from',
    'where',
    'aggregate',
    'count',
  ])
  return fullPath.some((segment) => dataVerbs.has(segment))
}

function looksLikeHttpClientCall(input: {
  baseIdentifier: string | null
  propertyPath: string[]
  externalPackage: string | null
}) {
  if (input.propertyPath.length === 0) return false
  const finalProperty = input.propertyPath[input.propertyPath.length - 1]?.toLowerCase()
  if (!finalProperty || !['get', 'post', 'put', 'patch', 'delete'].includes(finalProperty)) return false
  if ((input.externalPackage ?? '').toLowerCase().includes('axios')) return true
  const identifier = (input.baseIdentifier ?? '').toLowerCase()
  return ['axios', 'http', 'client', 'api'].includes(identifier)
}

function endpointFromAstCall(
  file: SourceGraphFile,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  enclosingFunctionNameValue: string | undefined,
  functionNodeByName: Map<string, ts.Node>,
  routerInstanceNames: Set<string>,
): EndpointEvidence | null {
  const { objectName, propertyName } = callPropertyName(node.expression)
  const method = propertyName?.toUpperCase()
  if (!method || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null
  if (!objectName || !routerInstanceNames.has(objectName)) return null
  const routePath = stringLiteralText(node.arguments[0])
  if (!routePath) return null
  const handler = node.arguments.length >= 2 ? node.arguments[node.arguments.length - 1] : undefined
  const handlerInfo = handlerNameAndSource(handler, sourceFile, functionNodeByName)
  return endpointFromAstSource({
    file,
    sourceFile,
    node,
    method,
    routePath,
    framework: objectName === 'fastify' ? 'fastify_ast' : 'express_ast',
    routerName: objectName,
    handlerName: handlerInfo.name,
    handlerSource: handlerInfo.source,
    enclosingFunctionName: enclosingFunctionNameValue,
  })
}

function routeMountFromAstCall(
  file: SourceGraphFile,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  imports: ImportEvidence[],
  enclosingFunctionNameValue: string | undefined,
  routerInstanceNames: Set<string>,
): RouteMountEvidence | null {
  const { objectName, propertyName } = callPropertyName(node.expression)
  if (propertyName !== 'use' && propertyName !== 'register') return null
  if (!objectName || !routerInstanceNames.has(objectName)) return null
  if (node.arguments.length < 2) return null

  const prefix = normalizeEndpointPath(stringLiteralText(node.arguments[0]) ?? '')
  const targetArgument = node.arguments[1]
  if (!prefix || prefix === '/' || !targetArgument || !ts.isIdentifier(targetArgument)) return null

  const targetImport = imports.find((item) => item.localBindings.includes(targetArgument.text))
  const source = {
    filePath: file.relativePath,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  }

  return {
    id: graphId('route_mount', file.relativePath, objectName, prefix, targetArgument.text, String(source.line ?? 1)),
    source,
    prefix,
    routerIdentifier: targetArgument.text,
    targetFilePath: targetImport?.targetFilePath ?? null,
    enclosingFunctionName: enclosingFunctionNameValue,
  }
}

function functionCallFromAstCall(
  file: SourceGraphFile,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  imports: ImportEvidence[],
  enclosingFunctionNameValue: string | undefined,
  routerInstanceNames: Set<string>,
): FunctionCallEvidence | null {
  if (!enclosingFunctionNameValue) return null
  if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') return null

  if (ts.isIdentifier(node.expression)) {
    const calleeName = node.expression.text
    if (!calleeName) return null
    const importMatch = imports.find((item) => item.localBindings.includes(calleeName))
    const source = {
      filePath: file.relativePath,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    }
    return {
      id: graphId('function_call', file.relativePath, enclosingFunctionNameValue, calleeName, String(source.line ?? 1)),
      source,
      callerFunctionName: enclosingFunctionNameValue,
      calleeName,
      targetFilePath: importMatch?.targetFilePath ?? null,
      targetLabel: calleeName,
      externalPackage: importMatch?.externalPackage ?? null,
      callCategory: isKnownDataPackage(importMatch?.externalPackage ?? null) ? 'data_access' : importMatch?.externalPackage ? 'external_client' : undefined,
    }
  }

  const targetDescriptor = callTargetDescriptor(node.expression)
  const propertyName = targetDescriptor.propertyPath[targetDescriptor.propertyPath.length - 1] ?? null
  const objectName = targetDescriptor.baseIdentifier
  if (!propertyName || !objectName || routerInstanceNames.has(objectName)) return null
  if (['json', 'send', 'status'].includes(propertyName)) return null
  const importMatch = imports.find((item) => item.localBindings.includes(objectName))
  if (looksLikeHttpClientCall({
    baseIdentifier: objectName,
    propertyPath: targetDescriptor.propertyPath,
    externalPackage: importMatch?.externalPackage ?? null,
  })) return null
  const source = {
    filePath: file.relativePath,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  }
  const callCategory = looksLikeDataAccessTarget({
    baseIdentifier: objectName,
    propertyPath: targetDescriptor.propertyPath,
    externalPackage: importMatch?.externalPackage ?? null,
  })
    ? 'data_access'
    : importMatch?.externalPackage
      ? 'external_client'
      : undefined
  return {
    id: graphId('function_call', file.relativePath, enclosingFunctionNameValue, targetDescriptor.fullName ?? `${objectName}.${propertyName}`, String(source.line ?? 1)),
    source,
    callerFunctionName: enclosingFunctionNameValue,
    calleeName: propertyName,
    targetFilePath: importMatch?.targetFilePath ?? null,
    targetLabel: targetDescriptor.fullName ?? `${objectName}.${propertyName}`,
    externalPackage: importMatch?.externalPackage ?? null,
    callCategory,
    baseIdentifier: objectName,
    propertyPath: targetDescriptor.propertyPath,
  }
}

function handlerNameAndSource(
  handler: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  functionNodeByName: Map<string, ts.Node>,
): { name?: string; source?: SourceLocation } {
  if (!handler) return {}
  if (ts.isIdentifier(handler)) {
    const targetNode = functionNodeByName.get(handler.text) ?? handler
    return {
      name: handler.text,
      source: {
        filePath: sourceFile.fileName,
        line: sourceFile.getLineAndCharacterOfPosition(targetNode.getStart(sourceFile)).line + 1,
      },
    }
  }
  if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
    return {
      name: 'inline_handler',
      source: {
        filePath: sourceFile.fileName,
        line: sourceFile.getLineAndCharacterOfPosition(handler.getStart(sourceFile)).line + 1,
      },
    }
  }
  return {}
}

function endpointFromAstSource(input: {
  file: SourceGraphFile
  sourceFile: ts.SourceFile
  node: ts.Node
  method: string
  routePath: string
  framework: string
  routerName?: string
  handlerName?: string
  handlerSource?: SourceLocation
  enclosingFunctionName?: string
  mountChain?: string[]
}): EndpointEvidence {
  const line = input.sourceFile.getLineAndCharacterOfPosition(input.node.getStart(input.sourceFile)).line + 1
  const normalizedPath = normalizeEndpointPath(input.routePath)
  return {
    id: graphId('endpoint', input.method, normalizedPath, input.file.relativePath, String(line)),
    method: input.method,
    routePath: normalizedPath,
    source: { filePath: input.file.relativePath, line },
    label: `${input.method} ${normalizedPath}`,
    framework: input.framework,
    routerName: input.routerName,
    handlerName: input.handlerName,
    handlerSource: input.handlerSource,
    enclosingFunctionName: input.enclosingFunctionName,
    mountChain: input.mountChain,
  }
}

function httpCallFromAstCall(
  file: SourceGraphFile,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  enclosingFunctionNameValue: string | undefined,
): HttpCallEvidence | null {
  if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
    const url = stringLiteralText(node.arguments[0])
    if (!url) return null
    const options = node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1]) ? node.arguments[1] : undefined
    const method = (objectLiteralStringProperty(options, 'method') ?? 'GET').toUpperCase()
    return httpCallFromAstSource(file, sourceFile, node, method, url, 'fetch_ast', enclosingFunctionNameValue)
  }

  const { objectName, propertyName } = callPropertyName(node.expression)
  if (!propertyName || !['get', 'post', 'put', 'patch', 'delete'].includes(propertyName.toLowerCase())) return null
  const url = stringLiteralText(node.arguments[0])
  if (!url) return null
  const client = objectName ? `${objectName}.${propertyName}` : propertyName
  return httpCallFromAstSource(file, sourceFile, node, propertyName.toUpperCase(), url, `${client}_ast`, enclosingFunctionNameValue)
}

function httpCallFromAstSource(
  file: SourceGraphFile,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  method: string,
  url: string,
  client: string,
  enclosingFunctionNameValue: string | undefined,
): HttpCallEvidence {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const normalizedPath = normalizeHttpCallPath(url)
  return {
    id: graphId('http_call', method, normalizedPath ?? url, file.relativePath, String(line)),
    method,
    url: sanitizeGraphText(url, 240),
    normalizedPath,
    source: { filePath: file.relativePath, line },
    label: `${method} ${normalizedPath ?? url}`,
    client,
    enclosingFunctionName: enclosingFunctionNameValue,
  }
}

function resolveRelativeImport(fromFilePath: string, specifier: string, filePathSet: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null
  const baseDir = path.posix.dirname(normalizePath(fromFilePath))
  const raw = normalizePath(path.posix.normalize(path.posix.join(baseDir, specifier)))
  const withoutExplicitJsExt = raw.replace(/\.(?:c|m)?jsx?$/i, '')
  const candidates = [
    raw,
    withoutExplicitJsExt,
    `${withoutExplicitJsExt}.ts`,
    `${withoutExplicitJsExt}.tsx`,
    `${withoutExplicitJsExt}.js`,
    `${withoutExplicitJsExt}.jsx`,
    `${withoutExplicitJsExt}.mjs`,
    `${withoutExplicitJsExt}.cjs`,
    `${withoutExplicitJsExt}/index.ts`,
    `${withoutExplicitJsExt}/index.tsx`,
    `${withoutExplicitJsExt}/index.js`,
    `${withoutExplicitJsExt}/index.jsx`,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.js`,
    `${raw}.jsx`,
    `${raw}.mjs`,
    `${raw}.cjs`,
    `${raw}/index.ts`,
    `${raw}/index.tsx`,
    `${raw}/index.js`,
    `${raw}/index.jsx`,
  ]
  return candidates.find((candidate) => filePathSet.has(candidate)) ?? null
}

function externalPackageName(specifier: string): string | null {
  if (specifier.startsWith('.')) return null
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0] ?? null
}

function collectEndpointEvidence(file: SourceGraphFile): EndpointEvidence[] {
  const endpoints: EndpointEvidence[] = []
  const expressLike = /\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi
  const fastifyLike = /\b(?:fastify|app)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi
  const routeExport = /\bexport\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g

  for (const match of file.content.matchAll(expressLike)) {
    endpoints.push(endpointFromMatch(file, match, match[1] ?? 'get', match[2] ?? '/', 'express'))
  }
  for (const match of file.content.matchAll(fastifyLike)) {
    endpoints.push(endpointFromMatch(file, match, match[1] ?? 'get', match[2] ?? '/', 'fastify'))
  }
  for (const match of file.content.matchAll(routeExport)) {
    const routePath = inferApiRouteFromFile(file.relativePath)
    if (!routePath) continue
    endpoints.push(endpointFromMatch(file, match, match[1] ?? 'GET', routePath, 'next_api_route'))
  }

  return endpoints
}

function endpointFromMatch(
  file: SourceGraphFile,
  match: RegExpMatchArray,
  method: string,
  routePath: string,
  framework: string,
): EndpointEvidence {
  const normalizedMethod = method.toUpperCase()
  const normalizedPath = normalizeEndpointPath(routePath)
  const line = lineForIndex(file.content, match.index ?? 0)
  return {
    id: graphId('endpoint', normalizedMethod, normalizedPath, file.relativePath, String(line)),
    method: normalizedMethod,
    routePath: normalizedPath,
    source: { filePath: file.relativePath, line },
    label: `${normalizedMethod} ${normalizedPath}`,
    framework,
  }
}

function collectHttpCallEvidence(file: SourceGraphFile): HttpCallEvidence[] {
  const calls: HttpCallEvidence[] = []
  const fetchCall = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{([\s\S]{0,300}?)\})?/g
  const axiosCall = /\baxios\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi

  for (const match of file.content.matchAll(fetchCall)) {
    const url = match[1] ?? ''
    if (!url) continue
    const methodMatch = (match[2] ?? '').match(/\bmethod\s*:\s*["'`]([A-Z]+)["'`]/i)
    const method = (methodMatch?.[1] ?? 'GET').toUpperCase()
    calls.push(httpCallFromMatch(file, match, method, url, 'fetch'))
  }
  for (const match of file.content.matchAll(axiosCall)) {
    const method = (match[1] ?? 'get').toUpperCase()
    const url = match[2] ?? ''
    if (!url) continue
    calls.push(httpCallFromMatch(file, match, method, url, 'axios'))
  }

  return calls
}

function composeMountedEndpoints(input: {
  imports: ImportEvidence[]
  endpoints: EndpointEvidence[]
  routeMounts: RouteMountEvidence[]
}) {
  const importsByFile = new Map<string, ImportEvidence[]>()
  for (const importItem of input.imports) {
    const list = importsByFile.get(importItem.source.filePath) ?? []
    list.push(importItem)
    importsByFile.set(importItem.source.filePath, list)
  }

  const endpointPool = [...input.endpoints]
  const composed: EndpointEvidence[] = []
  const seen = new Set(endpointPool.map((endpoint) => endpoint.id))

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let added = 0
    const candidates = [...endpointPool]

    for (const mount of input.routeMounts) {
      const mountedEndpoints = candidates.filter((endpoint) => endpointMatchesRouteMount(endpoint, mount, importsByFile))
      for (const endpoint of mountedEndpoints) {
        if (endpoint.mountChain?.includes(mount.id)) continue
        const prefixedPath = normalizeEndpointPath(`${mount.prefix}/${endpoint.routePath}`)
        const composedEndpoint: EndpointEvidence = {
          ...endpoint,
          id: graphId('endpoint', endpoint.method, prefixedPath, mount.source.filePath, String(mount.source.line ?? 1), endpoint.label),
          routePath: prefixedPath,
          source: mount.source,
          label: `${endpoint.method} ${prefixedPath}`,
          framework: `${endpoint.framework}_mounted`,
          mountChain: [...(endpoint.mountChain ?? []), mount.id],
          enclosingFunctionName: mount.enclosingFunctionName ?? endpoint.enclosingFunctionName,
        }
        if (seen.has(composedEndpoint.id)) continue
        seen.add(composedEndpoint.id)
        endpointPool.push(composedEndpoint)
        composed.push(composedEndpoint)
        added += 1
      }
    }

    if (added === 0) break
  }

  return composed
}

function endpointMatchesRouteMount(
  endpoint: EndpointEvidence,
  mount: RouteMountEvidence,
  importsByFile: Map<string, ImportEvidence[]>,
) {
  if (endpoint.source.filePath === mount.source.filePath && endpoint.routerName === mount.routerIdentifier) {
    return true
  }

  if (!mount.targetFilePath) return false
  if (endpoint.source.filePath !== mount.targetFilePath) return false

  const importedBindings = (importsByFile.get(mount.source.filePath) ?? []).find((item) =>
    item.targetFilePath === mount.targetFilePath && item.localBindings.includes(mount.routerIdentifier),
  )
  return Boolean(importedBindings)
}

function httpCallFromMatch(
  file: SourceGraphFile,
  match: RegExpMatchArray,
  method: string,
  url: string,
  client: string,
): HttpCallEvidence {
  const line = lineForIndex(file.content, match.index ?? 0)
  const normalizedPath = normalizeHttpCallPath(url)
  return {
    id: graphId('http_call', method, normalizedPath ?? url, file.relativePath, String(line)),
    method,
    url: sanitizeGraphText(url, 240),
    normalizedPath,
    source: { filePath: file.relativePath, line },
    label: `${method} ${normalizedPath ?? url}`,
    client,
  }
}

function inferApiRouteFromFile(relativePath: string): string | null {
  const normalized = normalizePath(relativePath)
  const appRouteMatch = normalized.match(/^(?:src\/)?app\/api\/(.+)\/route\.(?:t|j)s$/)
  if (appRouteMatch?.[1]) return normalizeEndpointPath('/api/' + appRouteMatch[1])
  const pagesRouteMatch = normalized.match(/^(?:src\/)?pages\/api\/(.+)\.(?:t|j)s$/)
  if (pagesRouteMatch?.[1]) return normalizeEndpointPath('/api/' + pagesRouteMatch[1].replace(/\/index$/, ''))
  return null
}

function normalizeEndpointPath(value: string) {
  const cleaned = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = cleaned.startsWith('/') ? cleaned : '/' + cleaned
  return withSlash.replace(/\[([^\]]+)\]/g, ':$1').replace(/\/$/, '') || '/'
}

function normalizeHttpCallPath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('${')) return null
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      return normalizeEndpointPath(parsed.pathname)
    } catch {
      return null
    }
  }
  if (trimmed.startsWith('/')) return normalizeEndpointPath(trimmed)
  return null
}

function sanitizeGraphText(value: string, max: number) {
  return value
    .replace(/\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .slice(0, max)
}

function flattenSurfaceEvidence(surfaceMap: FrontendSurfaceMap): Array<{
  kind: FrontendEvidenceKind
  item: Record<string, unknown> & { id: string }
}> {
  return [
    ...surfaceMap.routes.map((item) => ({ kind: 'route' as const, item })),
    ...surfaceMap.components.map((item) => ({ kind: 'component' as const, item })),
    ...surfaceMap.forms.map((item) => ({ kind: 'form' as const, item })),
    ...surfaceMap.buttons.map((item) => ({ kind: 'button' as const, item })),
    ...surfaceMap.texts.map((item) => ({ kind: 'text' as const, item })),
    ...surfaceMap.navigation.map((item) => ({ kind: 'navigation' as const, item })),
    ...surfaceMap.packages.map((item) => ({ kind: 'package' as const, item })),
    ...surfaceMap.frameworks.map((item) => ({ kind: 'framework' as const, item })),
    ...surfaceMap.tests.map((item) => ({ kind: 'test' as const, item })),
  ]
}

function addEvidenceEdges(input: {
  edges: Map<string, CodeGraphEdge>
  from: string
  refs: EvidenceRef[]
  evidenceNodeById: Map<string, string>
}) {
  for (const ref of input.refs) {
    const evidenceNodeId = input.evidenceNodeById.get(ref.evidenceId)
    if (!evidenceNodeId) continue
    addEdge(input.edges, {
      id: edgeId('has_evidence', input.from, evidenceNodeId),
      from: input.from,
      to: evidenceNodeId,
      type: 'has_evidence',
      metadata: { evidenceId: ref.evidenceId, kind: ref.kind },
    })
  }
}

function addCapabilityCandidate(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  capability: CapabilityCandidate
  evidenceNodeById: Map<string, string>
}) {
  const capabilityNodeId = addNode(input.nodes, {
    id: graphId('capability_candidate', input.capability.id),
    type: 'capability_candidate',
    label: input.capability.title,
    status: input.capability.status,
    confidence: input.capability.confidence,
    metadata: {
      capabilityId: input.capability.id,
      kind: input.capability.kind,
      purpose: input.capability.purpose,
      selectorHints: input.capability.selectorHints,
    },
  })
  addEdge(input.edges, {
    id: edgeId('contains', input.repositoryNodeId, capabilityNodeId),
    from: input.repositoryNodeId,
    to: capabilityNodeId,
    type: 'contains',
  })
  addEvidenceEdges({
    edges: input.edges,
    from: capabilityNodeId,
    refs: input.capability.evidenceRefs,
    evidenceNodeById: input.evidenceNodeById,
  })
  for (const surfaceId of input.capability.mappedSurfaceIds) {
    const surfaceNodeId = input.evidenceNodeById.get(surfaceId)
    if (!surfaceNodeId) continue
    addEdge(input.edges, {
      id: edgeId('maps_surface', capabilityNodeId, surfaceNodeId),
      from: capabilityNodeId,
      to: surfaceNodeId,
      type: 'maps_surface',
      metadata: { surfaceId },
    })
  }
  return capabilityNodeId
}

function addDomainDiscoveryGraph(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  bundle: DomainDiscoveryBundle
}) {
  const evidenceNodeById = new Map<string, string>()

  const domainNodeId = addNode(input.nodes, {
    id: graphId('domain', input.bundle.domain.domain),
    type: 'domain',
    label: input.bundle.domain.label ?? input.bundle.domain.domain,
    status: input.bundle.domain.status,
    confidence: input.bundle.domain.confidence,
    metadata: {
      summary: input.bundle.domain.summary,
      entities: input.bundle.domain.entities,
    },
  })
  addEdge(input.edges, {
    id: edgeId('infers_domain', input.repositoryNodeId, domainNodeId),
    from: input.repositoryNodeId,
    to: domainNodeId,
    type: 'infers_domain',
  })

  for (const { kind, item } of flattenSurfaceEvidence(input.bundle.surfaceMap)) {
    const evidenceNodeId = addNode(input.nodes, {
      id: graphId(kind, item.id),
      type: EVIDENCE_KIND_TO_NODE_TYPE[kind],
      label: evidenceLabel(kind, item),
      source: evidenceSource(item),
      metadata: {
        evidenceId: item.id,
        kind,
        extractedText: item.extractedText,
        ...(item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata : {}),
      },
    })
    evidenceNodeById.set(item.id, evidenceNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, evidenceNodeId),
      from: input.repositoryNodeId,
      to: evidenceNodeId,
      type: 'contains',
    })
  }

  addEvidenceEdges({
    edges: input.edges,
    from: domainNodeId,
    refs: input.bundle.domain.evidenceRefs,
    evidenceNodeById,
  })

  const capabilityNodeById = new Map<string, string>()
  for (const capability of input.bundle.capabilities) {
    const capabilityNodeId = addCapabilityCandidate({
      nodes: input.nodes,
      edges: input.edges,
      repositoryNodeId: input.repositoryNodeId,
      capability,
      evidenceNodeById,
    })
    capabilityNodeById.set(capability.id, capabilityNodeId)
  }

  const personaNodeById = new Map<string, string>()
  for (const persona of input.bundle.personas) {
    const personaNodeId = addNode(input.nodes, {
      id: graphId('persona_candidate', persona.id),
      type: 'persona_candidate',
      label: persona.title,
      status: persona.status,
      confidence: persona.confidence,
      metadata: {
        personaId: persona.id,
        goals: persona.goals,
        rationale: persona.rationale,
      },
    })
    personaNodeById.set(persona.id, personaNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, personaNodeId),
      from: input.repositoryNodeId,
      to: personaNodeId,
      type: 'contains',
    })
    addEvidenceEdges({
      edges: input.edges,
      from: personaNodeId,
      refs: persona.evidenceRefs,
      evidenceNodeById,
    })
    for (const capabilityId of persona.allowedCapabilityIds) {
      const capabilityNodeId = capabilityNodeById.get(capabilityId)
      if (!capabilityNodeId) continue
      addEdge(input.edges, {
        id: edgeId('allows_capability', personaNodeId, capabilityNodeId),
        from: personaNodeId,
        to: capabilityNodeId,
        type: 'allows_capability',
        metadata: { capabilityId },
      })
    }
  }

  for (const scenario of input.bundle.scenarios) {
    const scenarioNodeId = addNode(input.nodes, {
      id: graphId('scenario_candidate', scenario.id),
      type: 'scenario_candidate',
      label: scenario.title,
      status: scenario.status,
      confidence: scenario.confidence,
      metadata: {
        scenarioId: scenario.id,
        rationale: scenario.rationale,
      },
    })
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, scenarioNodeId),
      from: input.repositoryNodeId,
      to: scenarioNodeId,
      type: 'contains',
    })
    addEvidenceEdges({
      edges: input.edges,
      from: scenarioNodeId,
      refs: scenario.evidenceRefs,
      evidenceNodeById,
    })
    for (const personaId of scenario.participatingPersonaIds) {
      const personaNodeId = personaNodeById.get(personaId)
      if (!personaNodeId) continue
      addEdge(input.edges, {
        id: edgeId('uses_persona', scenarioNodeId, personaNodeId),
        from: scenarioNodeId,
        to: personaNodeId,
        type: 'uses_persona',
        metadata: { personaId },
      })
    }
    for (const capabilityId of scenario.requiredCapabilityIds) {
      const capabilityNodeId = capabilityNodeById.get(capabilityId)
      if (!capabilityNodeId) continue
      addEdge(input.edges, {
        id: edgeId('requires_capability', scenarioNodeId, capabilityNodeId),
        from: scenarioNodeId,
        to: capabilityNodeId,
        type: 'requires_capability',
        metadata: { capabilityId },
      })
    }
    for (const step of scenario.steps) {
      const stepNodeId = addNode(input.nodes, {
        id: graphId('scenario_step_candidate', scenario.id, step.id),
        type: 'scenario_step_candidate',
        label: step.title,
        metadata: {
          stepId: step.id,
          intent: step.intent,
          capabilityId: step.capabilityId,
        },
      })
      addEdge(input.edges, {
        id: edgeId('contains_step', scenarioNodeId, stepNodeId),
        from: scenarioNodeId,
        to: stepNodeId,
        type: 'contains_step',
      })
      addEvidenceEdges({
        edges: input.edges,
        from: stepNodeId,
        refs: step.evidenceRefs,
        evidenceNodeById,
      })
      if (step.capabilityId) {
        const capabilityNodeId = capabilityNodeById.get(step.capabilityId)
        if (capabilityNodeId) {
          addEdge(input.edges, {
            id: edgeId('requires_capability', stepNodeId, capabilityNodeId),
            from: stepNodeId,
            to: capabilityNodeId,
            type: 'requires_capability',
            metadata: { capabilityId: step.capabilityId },
          })
        }
      }
    }
  }

  if (input.bundle.audit) {
    const auditNodeId = addNode(input.nodes, {
      id: graphId('audit', input.bundle.audit.id),
      type: 'audit',
      label: input.bundle.audit.summary,
      status: input.bundle.audit.status,
      confidence: input.bundle.audit.confidence,
      metadata: {
        auditId: input.bundle.audit.id,
        findings: input.bundle.audit.findings,
      },
    })
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, auditNodeId),
      from: input.repositoryNodeId,
      to: auditNodeId,
      type: 'contains',
    })
    for (const candidateId of input.bundle.audit.downgradedCandidateIds) {
      const candidateNodeId = capabilityNodeById.get(candidateId)
        ?? personaNodeById.get(candidateId)
        ?? graphId('scenario_candidate', candidateId)
      if (!input.nodes.has(candidateNodeId)) continue
      addEdge(input.edges, {
        id: edgeId('downgraded_candidate', auditNodeId, candidateNodeId),
        from: auditNodeId,
        to: candidateNodeId,
        type: 'downgraded_candidate',
        metadata: { candidateId },
      })
    }
  }
}

function addSourceGraph(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  sourceGraph: SourceGraphEvidence
}) {
  const fileNodeByPath = new Map<string, string>()
  const endpointNodeByPath = new Map<string, string>()
  const functionNodeByFileAndName = new Map<string, string>()
  const functionNodeIdsByName = new Map<string, string[]>()
  const importedTargetsByFile = new Map<string, Set<string>>()
  const sourceFiles = new Set<string>()

  for (const importItem of input.sourceGraph.imports) {
    sourceFiles.add(importItem.source.filePath)
    if (importItem.targetFilePath) sourceFiles.add(importItem.targetFilePath)
    if (importItem.targetFilePath) {
      const imported = importedTargetsByFile.get(importItem.source.filePath) ?? new Set<string>()
      imported.add(importItem.targetFilePath)
      importedTargetsByFile.set(importItem.source.filePath, imported)
    }
  }
  for (const fn of input.sourceGraph.functions) sourceFiles.add(fn.source.filePath)
  for (const functionCall of input.sourceGraph.functionCalls) sourceFiles.add(functionCall.source.filePath)
  for (const endpoint of input.sourceGraph.endpoints) sourceFiles.add(endpoint.source.filePath)
  for (const call of input.sourceGraph.httpCalls) sourceFiles.add(call.source.filePath)
  for (const uiEventHandler of input.sourceGraph.uiEventHandlers) sourceFiles.add(uiEventHandler.source.filePath)

  for (const file of input.sourceGraph.files) {
    if (!sourceFiles.has(file.relativePath)) continue
    const fileNodeId = addNode(input.nodes, {
      id: graphId('source_file', file.relativePath),
      type: 'source_file',
      label: file.relativePath,
      source: { filePath: file.relativePath },
      metadata: { filePath: file.relativePath },
    })
    fileNodeByPath.set(file.relativePath, fileNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, fileNodeId),
      from: input.repositoryNodeId,
      to: fileNodeId,
      type: 'contains',
    })
  }

  for (const importItem of input.sourceGraph.imports) {
    const fromFileNodeId = fileNodeByPath.get(importItem.source.filePath)
    if (!fromFileNodeId) continue
    let targetNodeId: string | undefined
    if (importItem.targetFilePath) {
      targetNodeId = fileNodeByPath.get(importItem.targetFilePath)
    } else if (importItem.externalPackage) {
      targetNodeId = addNode(input.nodes, {
        id: graphId('package', importItem.externalPackage),
        type: 'package',
        label: importItem.externalPackage,
        metadata: {
          packageName: importItem.externalPackage,
          importSpecifier: importItem.specifier,
          source: 'ast_import',
        },
      })
      addEdge(input.edges, {
        id: edgeId('contains', input.repositoryNodeId, targetNodeId),
        from: input.repositoryNodeId,
        to: targetNodeId,
        type: 'contains',
      })
    }
    if (!targetNodeId) continue
    addEdge(input.edges, {
      id: edgeId('imports', fromFileNodeId, targetNodeId),
      from: fromFileNodeId,
      to: targetNodeId,
      type: 'imports',
      metadata: {
        specifier: importItem.specifier,
        source: importItem.source,
      },
    })
  }

  for (const fn of input.sourceGraph.functions) {
    const functionNodeId = addNode(input.nodes, {
      id: fn.id,
      type: fn.kind,
      label: fn.label,
      source: fn.source,
      metadata: {
        name: fn.name,
        kind: fn.kind,
        source: 'ast',
      },
    })
    functionNodeByFileAndName.set(`${fn.source.filePath}:${fn.name}`, functionNodeId)
    const ids = functionNodeIdsByName.get(fn.name) ?? []
    ids.push(functionNodeId)
    functionNodeIdsByName.set(fn.name, ids)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, functionNodeId),
      from: input.repositoryNodeId,
      to: functionNodeId,
      type: 'contains',
    })
    const fileNodeId = fileNodeByPath.get(fn.source.filePath)
    if (fileNodeId) {
      addEdge(input.edges, {
        id: edgeId('contains', fileNodeId, functionNodeId),
        from: fileNodeId,
        to: functionNodeId,
        type: 'contains',
      })
    }
  }

  for (const functionCall of input.sourceGraph.functionCalls) {
    const callerNodeId = functionNodeByFileAndName.get(`${functionCall.source.filePath}:${functionCall.callerFunctionName}`)
    if (!callerNodeId) continue

    const directMatches = [
      functionNodeByFileAndName.get(`${functionCall.source.filePath}:${functionCall.calleeName}`),
      functionCall.targetFilePath ? functionNodeByFileAndName.get(`${functionCall.targetFilePath}:${functionCall.calleeName}`) : undefined,
    ].filter(Boolean) as string[]
    const globalMatches = functionNodeIdsByName.get(functionCall.calleeName) ?? []
    let calleeNodeId = directMatches[0] ?? (globalMatches.length === 1 ? globalMatches[0] : undefined)
    if (!calleeNodeId && (functionCall.targetFilePath || functionCall.externalPackage || functionCall.callCategory)) {
      const syntheticLabel = functionCall.targetLabel ?? functionCall.calleeName
      calleeNodeId = addNode(input.nodes, {
        id: graphId(
          'service',
          functionCall.targetFilePath ?? functionCall.externalPackage ?? functionCall.source.filePath,
          syntheticLabel,
        ),
        type: 'service',
        label: syntheticLabel,
        source: functionCall.targetFilePath ? { filePath: functionCall.targetFilePath } : functionCall.source,
        metadata: {
          name: functionCall.calleeName,
          targetLabel: syntheticLabel,
          kind: functionCall.callCategory ?? 'external_client',
          externalPackage: functionCall.externalPackage,
          baseIdentifier: functionCall.baseIdentifier,
          propertyPath: functionCall.propertyPath,
          source: 'synthetic_call_target',
        },
      })
      addEdge(input.edges, {
        id: edgeId('contains', input.repositoryNodeId, calleeNodeId),
        from: input.repositoryNodeId,
        to: calleeNodeId,
        type: 'contains',
      })
      if (functionCall.targetFilePath) {
        const targetFileNodeId = fileNodeByPath.get(functionCall.targetFilePath)
        if (targetFileNodeId) {
          addEdge(input.edges, {
            id: edgeId('contains', targetFileNodeId, calleeNodeId),
            from: targetFileNodeId,
            to: calleeNodeId,
            type: 'contains',
          })
        }
      }
      if (functionCall.externalPackage) {
        const packageNodeId = addNode(input.nodes, {
          id: graphId('package', functionCall.externalPackage),
          type: 'package',
          label: functionCall.externalPackage,
          metadata: {
            packageName: functionCall.externalPackage,
            source: 'synthetic_call_target',
          },
        })
        addEdge(input.edges, {
          id: edgeId('contains', input.repositoryNodeId, packageNodeId),
          from: input.repositoryNodeId,
          to: packageNodeId,
          type: 'contains',
        })
        addEdge(input.edges, {
          id: edgeId('related_to', calleeNodeId, packageNodeId),
          from: calleeNodeId,
          to: packageNodeId,
          type: 'related_to',
          metadata: {
            relationship: 'backed_by_package',
          },
        })
      }
    }
    if (!calleeNodeId || calleeNodeId === callerNodeId) continue

    addEdge(input.edges, {
      id: edgeId('calls', callerNodeId, calleeNodeId),
      from: callerNodeId,
      to: calleeNodeId,
      type: 'calls',
      confidence: 0.72,
      metadata: {
        callType: 'function',
        callerFunctionName: functionCall.callerFunctionName,
        calleeName: functionCall.calleeName,
      },
    })
  }

  for (const endpoint of input.sourceGraph.endpoints) {
    const endpointNodeId = addNode(input.nodes, {
      id: endpoint.id,
      type: 'endpoint',
      label: endpoint.label,
      source: endpoint.source,
      metadata: {
        method: endpoint.method,
        path: endpoint.routePath,
        framework: endpoint.framework,
        routerName: endpoint.routerName,
        handlerName: endpoint.handlerName,
        enclosingFunctionName: endpoint.enclosingFunctionName,
        mountChain: endpoint.mountChain,
        isMountedRoute: Array.isArray(endpoint.mountChain) && endpoint.mountChain.length > 0,
      },
    })
    endpointNodeByPath.set(`${endpoint.method} ${endpoint.routePath}`, endpointNodeId)
    endpointNodeByPath.set(`ANY ${endpoint.routePath}`, endpointNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, endpointNodeId),
      from: input.repositoryNodeId,
      to: endpointNodeId,
      type: 'contains',
    })
    const fileNodeId = fileNodeByPath.get(endpoint.source.filePath)
    if (fileNodeId) {
      addEdge(input.edges, {
        id: edgeId('handles', fileNodeId, endpointNodeId),
        from: fileNodeId,
        to: endpointNodeId,
        type: 'handles',
      })
    }
    const handlerNodeId = endpoint.handlerName
      ? resolveEndpointHandlerNodeId({
          endpoint,
          functionNodeByFileAndName,
          functionNodeIdsByName,
          importedTargetsByFile,
          nodeById: input.nodes,
        })
      : undefined
    if (handlerNodeId) {
      addEdge(input.edges, {
        id: edgeId('handles', handlerNodeId, endpointNodeId),
        from: handlerNodeId,
        to: endpointNodeId,
        type: 'handles',
        metadata: { handlerName: endpoint.handlerName },
      })
    }
    if (endpoint.enclosingFunctionName) {
      const enclosingFunctionNodeId = functionNodeByFileAndName.get(`${endpoint.source.filePath}:${endpoint.enclosingFunctionName}`)
      if (enclosingFunctionNodeId) {
        addEdge(input.edges, {
          id: edgeId('handles', enclosingFunctionNodeId, endpointNodeId),
          from: enclosingFunctionNodeId,
          to: endpointNodeId,
          type: 'handles',
          metadata: { handlerName: endpoint.enclosingFunctionName, source: 'route_registration_function' },
        })
      }
    }
  }

  for (const call of input.sourceGraph.httpCalls) {
    const callNodeId = addNode(input.nodes, {
      id: call.id,
      type: 'http_call',
      label: call.label,
      source: call.source,
      metadata: {
        method: call.method,
        url: call.url,
        normalizedPath: call.normalizedPath,
        client: call.client,
        enclosingFunctionName: call.enclosingFunctionName,
      },
    })
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, callNodeId),
      from: input.repositoryNodeId,
      to: callNodeId,
      type: 'contains',
    })
    const fileNodeId = fileNodeByPath.get(call.source.filePath)
    if (fileNodeId) {
      addEdge(input.edges, {
        id: edgeId('makes_http_request', fileNodeId, callNodeId),
        from: fileNodeId,
        to: callNodeId,
        type: 'makes_http_request',
      })
    }
    if (call.enclosingFunctionName) {
      const functionNodeId = functionNodeByFileAndName.get(`${call.source.filePath}:${call.enclosingFunctionName}`)
      if (functionNodeId) {
        addEdge(input.edges, {
          id: edgeId('calls', functionNodeId, callNodeId),
          from: functionNodeId,
          to: callNodeId,
          type: 'calls',
          metadata: {
            callType: 'http_request',
            functionName: call.enclosingFunctionName,
          },
        })
      }
    }
    if (call.normalizedPath) {
      const endpointNodeId = endpointNodeByPath.get(`${call.method} ${call.normalizedPath}`)
        ?? endpointNodeByPath.get(`ANY ${call.normalizedPath}`)
      if (endpointNodeId) {
        addEdge(input.edges, {
          id: edgeId('calls', callNodeId, endpointNodeId),
          from: callNodeId,
          to: endpointNodeId,
          type: 'calls',
          confidence: 0.9,
          metadata: { matchedBy: 'method_path' },
        })
      }
    }
  }

  const uiSurfaceNodeByLocation = buildUiSurfaceNodeByLocation(input.nodes)
  for (const uiEventHandler of input.sourceGraph.uiEventHandlers) {
    const surfaceNodeId = findUiSurfaceNodeId(uiSurfaceNodeByLocation, uiEventHandler)
    if (!surfaceNodeId) continue
    const handlerNodeIds = resolveUiHandlerNodeIds({
      uiEventHandler,
      functionNodeByFileAndName,
      functionNodeIdsByName,
      importedTargetsByFile,
      nodeById: input.nodes,
    })
    for (const handlerNodeId of handlerNodeIds) {
      addEdge(input.edges, {
        id: edgeId('handles', handlerNodeId, surfaceNodeId),
        from: handlerNodeId,
        to: surfaceNodeId,
        type: 'handles',
        confidence: 0.78,
        metadata: {
          eventName: uiEventHandler.eventName,
          source: 'jsx_event_handler',
          handlerNames: uiEventHandler.handlerNames,
        },
      })
    }
  }
}

function resolveEndpointHandlerNodeId(input: {
  endpoint: EndpointEvidence
  functionNodeByFileAndName: Map<string, string>
  functionNodeIdsByName: Map<string, string[]>
  importedTargetsByFile: Map<string, Set<string>>
  nodeById: Map<string, CodeGraphNode>
}) {
  const handlerName = input.endpoint.handlerName
  if (!handlerName) return undefined

  const resolveImportedHandler = (filePath: string, visited = new Set<string>()): string | undefined => {
    if (visited.has(filePath)) return undefined
    visited.add(filePath)

    const directNodeId = input.functionNodeByFileAndName.get(`${filePath}:${handlerName}`)
    const directNode = directNodeId ? input.nodeById.get(directNodeId) : undefined
    if (directNodeId && directNode && directNode.type !== 'handler') return directNodeId

    const importedTargets = input.importedTargetsByFile.get(filePath) ?? new Set<string>()
    for (const importedFilePath of importedTargets) {
      const importedNodeId = resolveImportedHandler(importedFilePath, visited)
      if (importedNodeId) return importedNodeId
    }

    if (directNodeId) return directNodeId
    return undefined
  }

  const candidateFilePaths = [
    input.endpoint.source.filePath,
    input.endpoint.handlerSource?.filePath,
  ].filter(Boolean) as string[]

  for (const candidateFilePath of candidateFilePaths) {
    const importedNodeId = resolveImportedHandler(candidateFilePath)
    if (importedNodeId) return importedNodeId
  }

  const directMatches = [
    input.functionNodeByFileAndName.get(`${input.endpoint.source.filePath}:${handlerName}`),
    input.endpoint.handlerSource
      ? input.functionNodeByFileAndName.get(`${input.endpoint.handlerSource.filePath}:${handlerName}`)
      : undefined,
  ].filter(Boolean) as string[]
  if (directMatches.length > 0) return directMatches[0]

  const globalMatches = (input.functionNodeIdsByName.get(handlerName) ?? []).filter((id) => {
    const node = input.nodeById.get(id)
    return node?.type === 'function' || node?.type === 'handler' || node?.type === 'service'
  })
  if (globalMatches.length === 1) return globalMatches[0]
  return undefined
}

function buildUiSurfaceNodeByLocation(nodes: Map<string, CodeGraphNode>) {
  const map = new Map<string, Array<{ id: string; line: number }>>()
  for (const node of nodes.values()) {
    if (!['button', 'form'].includes(node.type)) continue
    if (!node.source?.filePath || !node.source?.line) continue
    const key = `${node.type}:${node.source.filePath}`
    const list = map.get(key) ?? []
    list.push({ id: node.id, line: node.source.line })
    map.set(key, list)
  }
  return map
}

function findUiSurfaceNodeId(
  uiSurfaceNodeByLocation: Map<string, Array<{ id: string; line: number }>>,
  uiEventHandler: UiEventHandlerEvidence,
) {
  const key = `${uiEventHandler.surfaceKind}:${uiEventHandler.source.filePath}`
  const candidates = uiSurfaceNodeByLocation.get(key) ?? []
  if (candidates.length === 0) return null
  const nearest = candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.line - (uiEventHandler.source.line ?? candidate.line)),
    }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (!nearest || nearest.distance > 3) return null
  return nearest.id
}

function resolveUiHandlerNodeIds(input: {
  uiEventHandler: UiEventHandlerEvidence
  functionNodeByFileAndName: Map<string, string>
  functionNodeIdsByName: Map<string, string[]>
  importedTargetsByFile: Map<string, Set<string>>
  nodeById: Map<string, CodeGraphNode>
}) {
  const handlerNodeIds = new Set<string>()
  const sourceFilePath = input.uiEventHandler.source.filePath
  const importedTargets = input.importedTargetsByFile.get(sourceFilePath) ?? new Set<string>()

  for (const handlerName of input.uiEventHandler.handlerNames) {
    const sameFileNodeId = input.functionNodeByFileAndName.get(`${sourceFilePath}:${handlerName}`)
    if (sameFileNodeId) {
      handlerNodeIds.add(sameFileNodeId)
      continue
    }

    for (const importedFilePath of importedTargets) {
      const importedNodeId = input.functionNodeByFileAndName.get(`${importedFilePath}:${handlerName}`)
      if (importedNodeId) handlerNodeIds.add(importedNodeId)
    }

    const globalMatches = input.functionNodeIdsByName.get(handlerName) ?? []
    if (handlerNodeIds.size === 0 && globalMatches.length === 1) {
      handlerNodeIds.add(globalMatches[0]!)
    }
  }

  return [...handlerNodeIds].filter((id) => {
    const node = input.nodeById.get(id)
    return node?.type === 'function' || node?.type === 'handler' || node?.type === 'service'
  })
}

function resolveCapabilitySupport(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
}) {
  const capabilities = [...input.nodes.values()].filter((node) => node.type === 'capability_candidate')
  const endpoints = [...input.nodes.values()].filter((node) => node.type === 'endpoint')
  const httpCalls = [...input.nodes.values()].filter((node) => node.type === 'http_call')
  const callsEndpoint = new Map<string, string[]>()
  const nodeById = new Map([...input.nodes.values()].map((node) => [node.id, node]))
  const incomingEdgesByNode = new Map<string, CodeGraphEdge[]>()
  const outgoingEdgesByNode = new Map<string, CodeGraphEdge[]>()
  const edgeByType = new Map<CodeGraphEdgeType, CodeGraphEdge[]>()

  const rememberEdge = (edge: CodeGraphEdge) => {
    const incoming = incomingEdgesByNode.get(edge.to) ?? []
    incoming.push(edge)
    incomingEdgesByNode.set(edge.to, incoming)

    const outgoing = outgoingEdgesByNode.get(edge.from) ?? []
    outgoing.push(edge)
    outgoingEdgesByNode.set(edge.from, outgoing)

    const typed = edgeByType.get(edge.type) ?? []
    typed.push(edge)
    edgeByType.set(edge.type, typed)

    if (edge.type === 'calls' && nodeById.get(edge.from)?.type === 'http_call' && nodeById.get(edge.to)?.type === 'endpoint') {
      const list = callsEndpoint.get(edge.from) ?? []
      list.push(edge.to)
      callsEndpoint.set(edge.from, list)
    }
  }

  for (const edge of input.edges.values()) rememberEdge(edge)

  const addSupportEdge = (params: {
    sourceNodeId: string
    capabilityNode: CodeGraphNode
    confidence: number
    matchedBy: string
    targetType: string
  }) => {
    const sourceNode = nodeById.get(params.sourceNodeId)
    if (!sourceNode) return
    const supportEdge: CodeGraphEdge = {
      id: edgeId('supports_capability', params.sourceNodeId, params.capabilityNode.id),
      from: params.sourceNodeId,
      to: params.capabilityNode.id,
      type: 'supports_capability',
      confidence: params.confidence,
      label: `${sourceNode.label} supports ${params.capabilityNode.label}`,
      metadata: {
        matchedBy: params.matchedBy,
        capabilityId: params.capabilityNode.metadata['capabilityId'] ?? params.capabilityNode.label,
        targetType: params.targetType,
        score: Number(params.confidence.toFixed(3)),
      },
    }
    if (input.edges.has(supportEdge.id)) return
    addEdge(input.edges, supportEdge)
    const created = input.edges.get(supportEdge.id)
    if (created) rememberEdge(created)
  }

  for (const capability of capabilities) {
    const mappedSurfaceEdges = (edgeByType.get('maps_surface') ?? []).filter((edge) => edge.from === capability.id)
    const directUiHandlerNodeIds = new Set<string>()
    for (const mappedSurfaceEdge of mappedSurfaceEdges) {
      for (const edge of incomingEdgesByNode.get(mappedSurfaceEdge.to) ?? []) {
        if (edge.type === 'handles' && edge.metadata?.['source'] === 'jsx_event_handler') {
          directUiHandlerNodeIds.add(edge.from)
        }
      }
    }

    const downstreamSupport = collectTransitiveFunctionSupport({
      startNodeIds: [...directUiHandlerNodeIds],
      nodeById,
      outgoingEdgesByNode,
    })

    const structuralHttpCallNodeIds = new Set<string>(downstreamSupport.httpCallNodeIds)
    const structuralEndpointNodeIds = new Set<string>()
    for (const httpCallNodeId of structuralHttpCallNodeIds) {
      for (const endpointNodeId of callsEndpoint.get(httpCallNodeId) ?? []) {
        structuralEndpointNodeIds.add(endpointNodeId)
      }
    }

    for (const handlerNodeId of directUiHandlerNodeIds) {
      addSupportEdge({
        sourceNodeId: handlerNodeId,
        capabilityNode: capability,
        confidence: 0.56,
        matchedBy: 'frontend_surface_handler_direct',
        targetType: 'handler',
      })
    }

    for (const handlerNodeId of downstreamSupport.handlerNodeIds) {
      addSupportEdge({
        sourceNodeId: handlerNodeId,
        capabilityNode: capability,
        confidence: 0.48,
        matchedBy: 'frontend_surface_handler_transitive',
        targetType: 'handler',
      })
    }

    for (const httpCallNodeId of structuralHttpCallNodeIds) {
      addSupportEdge({
        sourceNodeId: httpCallNodeId,
        capabilityNode: capability,
        confidence: 0.68,
        matchedBy: 'frontend_surface_http_call',
        targetType: 'http_call',
      })
    }

    for (const endpointNodeId of structuralEndpointNodeIds) {
      addSupportEdge({
        sourceNodeId: endpointNodeId,
        capabilityNode: capability,
        confidence: 0.74,
        matchedBy: 'frontend_surface_endpoint',
        targetType: 'endpoint',
      })
    }

    const capabilityTokens = tokenizeGraphText([
      capability.label,
      capability.metadata['capabilityId'],
      capability.metadata['purpose'],
      capability.metadata['kind'],
      capability.metadata['selectorHints'],
    ])
    const capabilityKind = typeof capability.metadata['kind'] === 'string' ? capability.metadata['kind'] : 'unknown'

    const endpointMatches = endpoints
      .map((endpoint) => ({
        node: endpoint,
        score: scoreCapabilityTarget(capabilityTokens, capabilityKind, endpoint),
      }))
      .filter((match) => match.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const httpCallMatches = httpCalls
      .map((call) => {
        const linkedEndpointIds = callsEndpoint.get(call.id) ?? []
        const linkedEndpointBoost = endpointMatches.some((match) => linkedEndpointIds.includes(match.node.id)) ? 0.2 : 0
        return {
          node: call,
          score: Math.min(1, scoreCapabilityTarget(capabilityTokens, capabilityKind, call) + linkedEndpointBoost),
        }
      })
      .filter((match) => match.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    for (const match of endpointMatches) {
      addSupportEdge({
        sourceNodeId: match.node.id,
        capabilityNode: capability,
        confidence: match.score,
        matchedBy: 'capability_token_endpoint',
        targetType: 'endpoint',
      })
    }

    for (const match of httpCallMatches) {
      addSupportEdge({
        sourceNodeId: match.node.id,
        capabilityNode: capability,
        confidence: match.score,
        matchedBy: 'capability_token_http_call',
        targetType: 'http_call',
      })
    }

    const finalSupportEdges = (incomingEdgesByNode.get(capability.id) ?? []).filter((edge) => edge.type === 'supports_capability')
    const mappedEndpointIds = uniqueStrings(finalSupportEdges
      .map((edge) => nodeById.get(edge.from))
      .filter((node): node is CodeGraphNode => Boolean(node?.type === 'endpoint'))
      .map((node) => node.id))
    const mappedHttpCallIds = uniqueStrings(finalSupportEdges
      .map((edge) => nodeById.get(edge.from))
      .filter((node): node is CodeGraphNode => Boolean(node?.type === 'http_call'))
      .map((node) => node.id))
    const mappedHandlerIds = uniqueStrings(finalSupportEdges
      .map((edge) => nodeById.get(edge.from))
      .filter((node): node is CodeGraphNode => Boolean(node && ['function', 'handler', 'service'].includes(node.type)))
      .map((node) => node.id))
    const bestScore = Math.max(0, ...finalSupportEdges.map((edge) => edge.confidence ?? 0))
    const resolver = finalSupportEdges.some((edge) => String(edge.metadata?.['matchedBy'] ?? '').startsWith('frontend_surface_'))
      ? 'capability_surface_graph_v2'
      : finalSupportEdges.length > 0
        ? 'capability_token_graph_v1'
        : 'capability_token_graph_v1'

    updateNodeMetadata(input.nodes, capability.id, {
      graphMapping: {
        status: finalSupportEdges.length > 0 ? 'mapped' : 'unmapped',
        confidence: Number(bestScore.toFixed(3)),
        endpointIds: mappedEndpointIds,
        httpCallIds: mappedHttpCallIds,
        handlerIds: mappedHandlerIds,
        resolver,
      },
    })
  }
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
}

function collectTransitiveFunctionSupport(input: {
  startNodeIds: string[]
  nodeById: Map<string, CodeGraphNode>
  outgoingEdgesByNode: Map<string, CodeGraphEdge[]>
  maxDepth?: number
}) {
  const handlerNodeIds = new Set<string>()
  const httpCallNodeIds = new Set<string>()
  const visited = new Set<string>()
  const maxDepth = input.maxDepth ?? 5
  const queue = input.startNodeIds
    .filter(Boolean)
    .map((id) => ({ id, depth: 0 }))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.id) || current.depth > maxDepth) continue
    visited.add(current.id)

    for (const edge of input.outgoingEdgesByNode.get(current.id) ?? []) {
      if (edge.type !== 'calls') continue
      const targetNode = input.nodeById.get(edge.to)
      if (!targetNode) continue
      if (targetNode.type === 'http_call') {
        httpCallNodeIds.add(targetNode.id)
        continue
      }
      if (!['function', 'handler', 'service'].includes(targetNode.type)) continue
      handlerNodeIds.add(targetNode.id)
      queue.push({ id: targetNode.id, depth: current.depth + 1 })
    }
  }

  return {
    handlerNodeIds: [...handlerNodeIds],
    httpCallNodeIds: [...httpCallNodeIds],
  }
}

function graphMappingFor(node: CodeGraphNode): Record<string, unknown> {
  const graphMapping = node.metadata['graphMapping']
  return graphMapping && typeof graphMapping === 'object' && !Array.isArray(graphMapping)
    ? graphMapping as Record<string, unknown>
    : {}
}

function enrichScenarioReadiness(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
}) {
  const nodeById = new Map([...input.nodes.values()].map((node) => [node.id, node]))
  const supportEdgesByCapability = new Map<string, CodeGraphEdge[]>()
  const requiredCapabilityEdgesByCandidate = new Map<string, CodeGraphEdge[]>()

  for (const edge of input.edges.values()) {
    if (edge.type === 'supports_capability') {
      const capabilityNode = nodeById.get(edge.to)
      if (capabilityNode?.type !== 'capability_candidate') continue
      const list = supportEdgesByCapability.get(edge.to) ?? []
      list.push(edge)
      supportEdgesByCapability.set(edge.to, list)
    }

    if (edge.type === 'requires_capability') {
      const fromNode = nodeById.get(edge.from)
      const toNode = nodeById.get(edge.to)
      if (
        !fromNode
        || !['scenario_candidate', 'scenario_step_candidate'].includes(fromNode.type)
        || toNode?.type !== 'capability_candidate'
      ) continue
      const list = requiredCapabilityEdgesByCandidate.get(edge.from) ?? []
      list.push(edge)
      requiredCapabilityEdgesByCandidate.set(edge.from, list)
    }
  }

  for (const candidate of input.nodes.values()) {
    if (!['scenario_candidate', 'scenario_step_candidate'].includes(candidate.type)) continue
    const requiredEdges = requiredCapabilityEdgesByCandidate.get(candidate.id) ?? []
    const requiredCapabilities = requiredEdges
      .map((edge) => nodeById.get(edge.to))
      .filter((node): node is CodeGraphNode => Boolean(node?.type === 'capability_candidate'))

    if (requiredCapabilities.length === 0) {
      updateNodeMetadata(input.nodes, candidate.id, {
        graphReadiness: {
          status: 'unmapped',
          confidence: 0,
          mappedCapabilityIds: [],
          missingCapabilityIds: [],
          requiredCapabilityCount: 0,
          mappedCapabilityCount: 0,
          resolver: 'scenario_graph_readiness_v1',
          reason: 'candidate has no required capabilities',
        },
      })
      continue
    }

    const mappedCapabilityIds: string[] = []
    const missingCapabilityIds: string[] = []
    const supportSourceIds = new Set<string>()
    const supportSourceTypes = new Set<string>()
    const supportScores: number[] = []
    let supportEndpointCount = 0
    let supportHandlerCount = 0
    let supportHttpCallCount = 0
    let supportDataAccessCount = 0

    for (const capability of requiredCapabilities) {
      const supportEdges = supportEdgesByCapability.get(capability.id) ?? []
      const mapping = graphMappingFor(capability)
      const capabilityId = typeof capability.metadata['capabilityId'] === 'string'
        ? capability.metadata['capabilityId']
        : capability.label
      const mappingStatus = typeof mapping['status'] === 'string'
        ? mapping['status']
        : supportEdges.length > 0 ? 'mapped' : 'unmapped'

      if (mappingStatus === 'mapped') {
        mappedCapabilityIds.push(capabilityId)
      } else {
        missingCapabilityIds.push(capabilityId)
      }

      const confidence = typeof mapping['confidence'] === 'number'
        ? mapping['confidence']
        : Math.max(0, ...supportEdges.map((edge) => edge.confidence ?? 0))
      if (confidence > 0) supportScores.push(confidence)

      for (const edge of supportEdges) {
        const sourceNode = nodeById.get(edge.from)
        if (!sourceNode) continue
        supportSourceIds.add(sourceNode.id)
        supportSourceTypes.add(sourceNode.type)
        if (sourceNode.type === 'endpoint') supportEndpointCount += 1
        if (sourceNode.type === 'http_call') supportHttpCallCount += 1
        if (['function', 'handler', 'service'].includes(sourceNode.type)) {
          supportHandlerCount += 1
          if (sourceNode.metadata['kind'] === 'data_access') supportDataAccessCount += 1
        }
        addEdge(input.edges, {
          id: edgeId('related_to', candidate.id, sourceNode.id),
          from: candidate.id,
          to: sourceNode.id,
          type: 'related_to',
          confidence: edge.confidence,
          metadata: {
            relation: 'graph_readiness_support',
            capabilityId,
            supportEdgeId: edge.id,
          },
        })
      }
    }

    const mappedCapabilityCount = mappedCapabilityIds.length
    const requiredCapabilityCount = requiredCapabilities.length
    const confidence = supportScores.length > 0
      ? supportScores.reduce((sum, score) => sum + score, 0) / supportScores.length
      : 0
    const status = mappedCapabilityCount === requiredCapabilityCount
      ? 'fully_mapped'
      : mappedCapabilityCount > 0 ? 'partially_mapped' : 'unmapped'

    updateNodeMetadata(input.nodes, candidate.id, {
      graphReadiness: {
        status,
        confidence: Number(confidence.toFixed(3)),
        mappedCapabilityIds,
        missingCapabilityIds,
        requiredCapabilityCount,
        mappedCapabilityCount,
        supportSourceIds: [...supportSourceIds].slice(0, 20),
        supportSourceTypes: [...supportSourceTypes].sort(),
        supportEndpointCount,
        supportHandlerCount,
        supportHttpCallCount,
        supportDataAccessCount,
        resolver: 'scenario_graph_readiness_v1',
      },
    })
  }
}

function scoreCapabilityTarget(capabilityTokens: Set<string>, capabilityKind: string, target: CodeGraphNode) {
  const targetTokens = tokenizeGraphText([
    target.label,
    target.metadata['path'],
    target.metadata['normalizedPath'],
    target.metadata['url'],
    target.metadata['method'],
  ])
  let score = overlapScore(capabilityTokens, targetTokens)
  const method = String(target.metadata['method'] ?? '').toUpperCase()
  if (['form_submit', 'api_call', 'button_click'].includes(capabilityKind) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    score += 0.18
  }
  if (capabilityTokens.has('submit') && method === 'POST') score += 0.18
  if ((capabilityTokens.has('create') || capabilityTokens.has('add')) && method === 'POST') score += 0.16
  if ((capabilityTokens.has('update') || capabilityTokens.has('edit')) && ['PUT', 'PATCH'].includes(method)) score += 0.16
  if ((capabilityTokens.has('delete') || capabilityTokens.has('remove')) && method === 'DELETE') score += 0.16
  if ((capabilityTokens.has('open') || capabilityTokens.has('view') || capabilityTokens.has('list')) && method === 'GET') score += 0.12
  return Math.min(1, score)
}

function addDraftGraph(input: {
  nodes: Map<string, CodeGraphNode>
  edges: Map<string, CodeGraphEdge>
  repositoryNodeId: string
  draft: BootstrapDraft
}) {
  const capabilityNodeById = new Map<string, string>()
  for (const capabilityId of input.draft.capabilityCandidates) {
    const capabilityNodeId = addNode(input.nodes, {
      id: graphId('capability_candidate', capabilityId),
      type: 'capability_candidate',
      label: capabilityId,
      status: 'draft',
      metadata: { capabilityId, source: 'bootstrap_draft' },
    })
    capabilityNodeById.set(capabilityId, capabilityNodeId)
    addEdge(input.edges, {
      id: edgeId('contains', input.repositoryNodeId, capabilityNodeId),
      from: input.repositoryNodeId,
      to: capabilityNodeId,
      type: 'contains',
    })
  }

  const personaNodeById = new Map<string, string>()
  for (const persona of input.draft.personas) {
    const personaNodeId = addDraftPersona(input.nodes, input.edges, input.repositoryNodeId, persona)
    personaNodeById.set(persona.id, personaNodeId)
    for (const capabilityId of persona.allowedTools) {
      const capabilityNodeId = capabilityNodeById.get(capabilityId)
      if (!capabilityNodeId) continue
      addEdge(input.edges, {
        id: edgeId('allows_capability', personaNodeId, capabilityNodeId),
        from: personaNodeId,
        to: capabilityNodeId,
        type: 'allows_capability',
        metadata: { capabilityId },
      })
    }
  }

  for (const scenario of input.draft.scenarios) {
    addDraftScenario(input.nodes, input.edges, input.repositoryNodeId, scenario, personaNodeById, capabilityNodeById)
  }
}

function addDraftPersona(
  nodes: Map<string, CodeGraphNode>,
  edges: Map<string, CodeGraphEdge>,
  repositoryNodeId: string,
  persona: GeneratedPersonaDraft,
) {
  const personaNodeId = addNode(nodes, {
    id: graphId('persona_candidate', persona.id),
    type: 'persona_candidate',
    label: persona.title,
    status: 'draft',
    metadata: {
      personaId: persona.id,
      rationale: persona.rationale,
      allowedTools: persona.allowedTools,
      source: 'bootstrap_draft',
    },
  })
  addEdge(edges, {
    id: edgeId('contains', repositoryNodeId, personaNodeId),
    from: repositoryNodeId,
    to: personaNodeId,
    type: 'contains',
  })
  return personaNodeId
}

function addDraftScenario(
  nodes: Map<string, CodeGraphNode>,
  edges: Map<string, CodeGraphEdge>,
  repositoryNodeId: string,
  scenario: GeneratedScenarioDraft,
  personaNodeById: Map<string, string>,
  capabilityNodeById: Map<string, string>,
) {
  const scenarioNodeId = addNode(nodes, {
    id: graphId('scenario_candidate', scenario.id),
    type: 'scenario_candidate',
    label: scenario.title,
    status: 'draft',
    metadata: {
      scenarioId: scenario.id,
      rationale: scenario.rationale,
      source: 'bootstrap_draft',
    },
  })
  addEdge(edges, {
    id: edgeId('contains', repositoryNodeId, scenarioNodeId),
    from: repositoryNodeId,
    to: scenarioNodeId,
    type: 'contains',
  })
  for (const roleId of scenario.participatingRoles) {
    const personaNodeId = personaNodeById.get(roleId)
    if (!personaNodeId) continue
    addEdge(edges, {
      id: edgeId('uses_persona', scenarioNodeId, personaNodeId),
      from: scenarioNodeId,
      to: personaNodeId,
      type: 'uses_persona',
      metadata: { personaId: roleId },
    })
  }
  for (const step of scenario.candidateSteps) {
    const stepNodeId = addNode(nodes, {
      id: graphId('scenario_step_candidate', scenario.id, step),
      type: 'scenario_step_candidate',
      label: step,
      status: 'draft',
      metadata: {
        stepId: step,
        source: 'bootstrap_draft',
      },
    })
    addEdge(edges, {
      id: edgeId('contains_step', scenarioNodeId, stepNodeId),
      from: scenarioNodeId,
      to: stepNodeId,
      type: 'contains_step',
    })
    const capabilityId = toCamelCase(step)
    const capabilityNodeId = capabilityNodeById.get(capabilityId)
    if (!capabilityNodeId) continue
    addEdge(edges, {
      id: edgeId('requires_capability', stepNodeId, capabilityNodeId),
      from: stepNodeId,
      to: capabilityNodeId,
      type: 'requires_capability',
      metadata: { capabilityId },
    })
    addEdge(edges, {
      id: edgeId('requires_capability', scenarioNodeId, capabilityNodeId),
      from: scenarioNodeId,
      to: capabilityNodeId,
      type: 'requires_capability',
      metadata: { capabilityId },
    })
  }
}

export async function buildCodeGraph(input: BuildCodeGraphInput): Promise<CodeGraph> {
  const nodes = new Map<string, CodeGraphNode>()
  const edges = new Map<string, CodeGraphEdge>()
  const repositoryNodeId = graphId('repository', input.targetId)
  const repositoryKind = input.report.repository?.kind ?? 'unknown'
  const sourceGraph = await scanSourceGraph(input.repoPath)

  addNode(nodes, {
    id: repositoryNodeId,
    type: 'repository',
    label: input.targetId,
    confidence: input.report.repository?.confidence,
    metadata: {
      targetId: input.targetId,
      framework: input.report.framework,
      repository: input.report.repository,
      risks: input.report.risks,
    },
  })

  for (const surface of input.report.surfaces) {
    const surfaceNodeId = addNode(nodes, {
      id: graphId('surface', surface.id),
      type: surfaceNodeType(surface),
      label: surface.label,
      metadata: {
        surfaceId: surface.id,
        kind: surface.kind,
        evidence: surface.evidence,
      },
    })
    addEdge(edges, {
      id: edgeId('contains', repositoryNodeId, surfaceNodeId),
      from: repositoryNodeId,
      to: surfaceNodeId,
      type: 'contains',
    })
  }

  for (const role of input.report.roles) {
    const roleNodeId = addNode(nodes, {
      id: graphId('role', role.id),
      type: 'role',
      label: role.id,
      confidence: role.confidence,
      metadata: {
        roleId: role.id,
        evidence: role.evidence,
      },
    })
    addEdge(edges, {
      id: edgeId('contains', repositoryNodeId, roleNodeId),
      from: repositoryNodeId,
      to: roleNodeId,
      type: 'contains',
    })
  }

  if (input.report.domainDiscovery) {
    addDomainDiscoveryGraph({
      nodes,
      edges,
      repositoryNodeId,
      bundle: input.report.domainDiscovery,
    })
  }

  addSourceGraph({
    nodes,
    edges,
    repositoryNodeId,
    sourceGraph,
  })

  addDraftGraph({
    nodes,
    edges,
    repositoryNodeId,
    draft: input.draft,
  })

  resolveCapabilitySupport({ nodes, edges })
  enrichScenarioReadiness({ nodes, edges })

  const graphNodes = [...nodes.values()]
  const graphEdges = [...edges.values()].filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
  return CodeGraphSchema.parse({
    schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    targetId: input.targetId,
    repositoryKind,
    generatedAt: new Date().toISOString(),
    nodes: graphNodes,
    edges: graphEdges,
    stats: {
      nodeCount: graphNodes.length,
      edgeCount: graphEdges.length,
      evidenceNodeCount: graphNodes.filter((node) => [
        'surface',
        'source_file',
        'route',
        'component',
        'form',
        'button',
        'text',
        'navigation',
        'package',
        'framework',
        'test',
      ].includes(node.type)).length,
      candidateNodeCount: graphNodes.filter((node) => [
        'persona_candidate',
        'scenario_candidate',
        'scenario_step_candidate',
        'capability_candidate',
      ].includes(node.type)).length,
    },
  })
}
