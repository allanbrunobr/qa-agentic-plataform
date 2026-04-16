import { installLocalPackage } from '../services/local-package-installer.ts'

export async function runInstallLocalCommand(args: string[]) {
  const repoPath = args[0]
  if (!repoPath) {
    throw new Error('install-local requires <repoPath>')
  }

  const result = await installLocalPackage({ repoPath })
  process.stdout.write(`${JSON.stringify(result, null, 2)}
`)
}
