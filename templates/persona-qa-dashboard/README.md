# Agentic QA Dashboard Template

Runtime local instalado pelo Agentic Platform dentro de um repositorio alvo como `.agentic-qa`.

Este template nao contem personas, cenarios ou regras de dominio fixas. Esses artefatos sao gerados pelo discovery do AP em `adapter/` e depois consumidos pelo dashboard e pela API local.

## Estrutura

```
.agentic-qa/
├── adapter/                   # Modelo gerado para o repositorio alvo
│   ├── personas/              # Personas geradas pelo discovery
│   ├── scenarios/             # Cenarios gerados pelo discovery
│   ├── capabilities/          # Capacidades mapeadas para automacao
│   ├── auth/                  # Hints de autenticacao
│   ├── routes/                # Superficies/rotas descobertas
│   ├── runtime/               # Stubs e snapshot de suporte do host
│   └── config/                # Relatorio de discovery e metadata
├── packages/
│   ├── api/                   # API Fastify, runtime agentico e persistencia local
│   └── web/                   # Dashboard Vite/React
├── data/                      # Dados locais de execucao
├── docs/                      # Documentacao operacional do runtime
└── scripts/                   # Launchers gerados pelo instalador
```

## Fluxo De Uso

1. O AP instala este template no repositorio alvo.
2. O discovery analisa o alvo e escreve os arquivos `adapter/**/*.generated.*`.
3. O dashboard lista personas e cenarios a partir do adapter gerado.
4. Os runs executam cenarios usando capabilities e contratos do adapter.

Sem discovery/materializacao, a API retorna listas vazias para personas e cenarios em vez de carregar exemplos fixos.

Para repositorios front-end, o runtime usa Playwright e `ANTHROPIC_API_KEY`. Para repositorios backend API, CLI, library, monorepo ou unknown, o runtime usa execucao deterministica sem browser/modelo: ele inspeciona o repositorio, executa probes seguros quando houver URL/comando configurado, e grava artefatos de dry-run quando faltar mapeamento real.

## Variaveis Principais

| Variavel | Uso |
| --- | --- |
| `ANTHROPIC_API_KEY` | Chave usada pelo runtime local para chamadas de modelo. |
| `PLAYWRIGHT_BASE_URL` | URL base do frontend alvo a ser testado. |
| `GENERIC_API_BASE_URL` / `TARGET_API_BASE_URL` / `API_BASE_URL` | URL base para probes reais de backend API. |
| `GENERIC_CLI_COMMAND` / `TARGET_CLI_COMMAND` | Comando CLI quando o package `bin` nao for suficiente. |
| `PERSONA_QA_PERSONAS_FILE` | Override opcional para `adapter/personas/personas.generated.json`. |
| `PERSONA_QA_SCENARIOS_FILE` | Override opcional para `adapter/scenarios/scenarios.generated.json`. |

## Desenvolvimento Local

```bash
npm install --legacy-peer-deps
npm run dev --workspace packages/api
npm exec vite -- packages/web --config packages/web/vite.config.ts
```

Em instalacoes reais, prefira o script gerado:

```bash
./scripts/start-local-dashboard.generated.sh --api-port 3201 --web-port 5176
```
