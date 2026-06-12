import { promises as fs } from 'node:fs'
import {
  resolveGeneratedDir,
  resolveGeneratedFile,
} from '../config/platform-paths.ts'

// (asserts live above; duplicates removed by platform-paths integration)

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
  const filePath = resolveGeneratedFile(adapterId, filename)
  const content = await fs.readFile(filePath, 'utf8')
  return { filePath, content }
}

export async function writeGeneratedAdapterFile(adapterId: string, filename: string, content: string) {
  assertGeneratedAdapter(adapterId)
  assertFilename(filename)
  const filePath = resolveGeneratedFile(adapterId, filename)
  await fs.writeFile(filePath, content, 'utf8')
  return { filePath }
}
