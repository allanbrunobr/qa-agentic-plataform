import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dump } from 'js-yaml'
import { workflowContracts } from '../workflow-contracts/index.js'

const OUTPUT_DIR = path.resolve(process.cwd(), 'artifacts', 'workflow-contracts')

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true })

  for (const [scenarioId, contract] of Object.entries(workflowContracts)) {
    const jsonPath = path.join(OUTPUT_DIR, `${scenarioId}.json`)
    const yamlPath = path.join(OUTPUT_DIR, `${scenarioId}.yaml`)

    await writeFile(jsonPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
    await writeFile(
      yamlPath,
      `${dump(contract, {
        noRefs: true,
        lineWidth: 120,
        quotingType: "'",
      })}`,
      'utf8',
    )
  }

  const manifestPath = path.join(OUTPUT_DIR, 'index.json')
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        scenarios: Object.keys(workflowContracts),
        outputDir: OUTPUT_DIR,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  console.log(`Exported ${Object.keys(workflowContracts).length} workflow contract(s) to ${OUTPUT_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
