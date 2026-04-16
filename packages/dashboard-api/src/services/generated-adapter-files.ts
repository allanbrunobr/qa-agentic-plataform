import { promises as fs } from 'node:fs'
import path from 'node:path'

const ADAPTERS_ROOT = path.resolve('/path/to/projects/agentic-platform/adapters')

function baseAdapterId(adapterId: string) {
  return adapterId.endsWith('-generated') ? adapterId.slice(0, -'-generated'.length) : adapterId
}

function resolveGeneratedDir(adapterId: string) {
  return path.join(ADAPTERS_ROOT, baseAdapterId(adapterId), 'src', 'model', 'generated')
}

function assertGeneratedAdapter(adapterId: string) {
  if (!adapterId.endsWith('-generated')) {
    throw new Error(`Adapter does not support generated file editing: ${adapterId}`)
  }
}

function assertFilename(filename: string) {
  if (!/^[a-z0-9._-]+$/i.test(filename)) {
    throw new Error(`Invalid generated filename: ${filename}`)
  }
}

export async function listGeneratedAdapterFiles(adapterId: string) {
  assertGeneratedAdapter(adapterId)
  const dir = resolveGeneratedDir(adapterId)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.generated.ts'))
    .map((entry) => entry.name)
    .sort()
}

export async function readGeneratedAdapterFile(adapterId: string, filename: string) {
  assertGeneratedAdapter(adapterId)
  assertFilename(filename)
  const filePath = path.join(resolveGeneratedDir(adapterId), filename)
  const content = await fs.readFile(filePath, 'utf8')
  return { filePath, content }
}

export async function writeGeneratedAdapterFile(adapterId: string, filename: string, content: string) {
  assertGeneratedAdapter(adapterId)
  assertFilename(filename)
  const filePath = path.join(resolveGeneratedDir(adapterId), filename)
  await fs.writeFile(filePath, content, 'utf8')
  return { filePath }
}
