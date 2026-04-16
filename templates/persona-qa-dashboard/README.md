# Persona QA — Dashboard & Testes

Sistema de testes end-to-end baseado em personas lojas para o Reference Store frontend.

## Estrutura

```
persona-qa-dashboard/          ← Dashboard web (este diretório)
├── packages/
│   ├── web/                   ← Frontend (Vite + React 18 + Tailwind 4)  → porta 5173
│   └── api/                   ← Backend (Fastify 5 + Drizzle + SQLite)   → porta 3001
├── agents/                    ← Definições das personas (.md)
├── docs/                      ← Documentação e relatórios
└── docker-compose.yml         ← Orquestração dos dois serviços

integration-test/persona-tests/ ← Testes Playwright
├── specs/                     ← 3 specs (51 testes no total)
├── support/                   ← Capabilities, assertions, workflows
├── scenarios/                 ← Cenários YAML com steps e critérios
├── scripts/                   ← Runners e utilidades
└── utils/                     ← Helpers (criteria-asserter, scenario-loader)
```

---

## Pré-requisitos

- Docker Desktop rodando com os containers do Reference Store:
  - `frontend-webapp` (porta 3012)
  - `reference-store-api-db-1` (MySQL, porta 3306)
  - `reference-store-api-api-1` (porta 8001)
  - `reference-store-app-app-1` (porta 8004)
- Node.js 20+
- pnpm instalado

Verifique se o Reference Store está rodando:
```bash
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep reference-store
```

---

## Executando os testes

### Comando principal (recomendado)

```bash
# Limpa o banco + roda todos os testes
pnpm test:persona-qa:clean-run
```

### Passo a passo

```bash
# 1. Limpar dados de teste acumulados no MySQL
pnpm test:persona-qa:clean

# 2. Rodar os 3 specs (cada um em processo isolado)
pnpm test:persona-qa
```

### Rodar um spec individual

```bash
npx playwright test integration-test/persona-tests/specs/first-order.spec.ts -c playwright.config.ts
npx playwright test integration-test/persona-tests/specs/quarterly-reorder.spec.ts -c playwright.config.ts
npx playwright test integration-test/persona-tests/specs/cancelamento-e-remarcacao.spec.ts -c playwright.config.ts
```

### Outros comandos

| Comando | Descrição |
|---------|-----------|
| `pnpm test:persona-qa` | Roda todos os specs (isolados) |
| `pnpm test:persona-qa:clean` | Limpa dados de teste do MySQL |
| `pnpm test:persona-qa:clean-run` | Limpa + roda tudo |
| `pnpm test:persona-qa:all-single-process` | Roda tudo num único processo Playwright (pode falhar por acumulação) |
| `pnpm test:persona-qa:gate` | Verifica gate de PR |

---

## Resultado esperado

```
═══════════════════════════════════════════════════════════
  Running: cancelamento-e-remarcacao
═══════════════════════════════════════════════════════════
  9 passed

═══════════════════════════════════════════════════════════
  Running: first-order
═══════════════════════════════════════════════════════════
  17 passed

═══════════════════════════════════════════════════════════
  Running: quarterly-reorder
═══════════════════════════════════════════════════════════
  25 passed

═══════════════════════════════════════════════════════════
  TOTAL: 51 passed, 0 skipped, 0 failed
═══════════════════════════════════════════════════════════
  All specs passed!
```

---

## Iniciando o Dashboard

O dashboard visualiza os resultados dos testes, cenários e findings.

### Opção 1: Docker Compose (mais simples)

```bash
cd persona-qa-dashboard

# Sobe API + Web
PERSONA_QA_PROJECT_DIR="$(cd .. && pwd)" docker compose up
```

- Web: http://localhost:5173
- API: http://localhost:3001

### Opção 2: Manual (desenvolvimento)

**Terminal 1 — API:**
```bash
cd persona-qa-dashboard/packages/api
npm install
PERSONA_QA_PROJECT_DIR="/caminho/para/reference-store-frontend" npm run dev
```
→ API rodando em http://localhost:3001

**Terminal 2 — Web:**
```bash
cd persona-qa-dashboard/packages/web
npm install
npm run dev
```
→ Dashboard rodando em http://localhost:5173

### Páginas do Dashboard

| Página | Descrição |
|--------|-----------|
| **Overview** | Gráficos de passes/falhas, estatísticas gerais |
| **Scenarios** | Lista de cenários YAML com steps e critérios |
| **Findings** | Issues encontradas com screenshots |
| **Runs** | Histórico de execuções com logs ao vivo (WebSocket) |
| **Personas** | CRUD das personas (Sales Associate, Fulfillment Agent, etc.) |
| **PR Tracking** | Acompanhamento de PRs |
| **Insights** | 3 especialistas AI para análise |

---

## Cenários de teste

| Cenário | Customer | Fulfillment Agent | Testes | Descrição |
|---------|----------|--------|--------|-----------|
| **First order** | Maria (nova) | Dr. Carlos | 17 | Cadastro, pedido, pedido completa, recibo |
| **Quarterly reorder** | Roberto (crônico) | Dr. Carlos | 25 | Histórico de 3 pedidos, retorno, Billing, relatórios |
| **Cancelamento** | Roberto | Dr. Carlos | 9 | Agendar, verificar ausência de cobrança/guia Billing |

## Personas

| Persona | O que testa |
|---------|-------------|
| **Sales Associate** | Cadastro customer, pedido, busca |
| **Fulfillment Agent** | Registro, Notes, Iniciar/Finalizar pedido |
| **Customer** | Dados corretos no registro, conta |
| **Billing clerk** | Página Billing, tabela de guias, filtros |
| **Gestor** | Painel financeiro, relatórios |

---

## Troubleshooting

### Testes falham com timeout no `beforeAll`

O banco está poluído com dados de teste. Limpe antes de rodar:
```bash
pnpm test:persona-qa:clean
```

### "Oops, ocorreu um erro" no registro

O `eventId` capturado pode estar incorreto. Rode o spec individualmente:
```bash
npx playwright test integration-test/persona-tests/specs/first-order.spec.ts -c playwright.config.ts
```

### Container MySQL não encontrado

O script espera `reference-store-api-db-1`. Se o nome for diferente:
```bash
MYSQL_CONTAINER=nome-do-container pnpm test:persona-qa:clean
```

### Dashboard API não conecta

Verifique se `PERSONA_QA_PROJECT_DIR` aponta para a raiz do `reference-store-frontend`:
```bash
PERSONA_QA_PROJECT_DIR="$(pwd)" npm run dev  # de dentro de reference-store-frontend
```

---

## Documentação adicional

- [Relatório Fase 1](docs/RELATORIO_FASE1_TESTES.md) — Problemas encontrados, soluções, detalhamento dos 51 testes
- [Mapa de Seletores](docs/SELECTOR_MAP.md) — Seletores reais do Reference Store descobertos por análise de código
- [Arquitetura Fase 1](docs/PHASE1_ARCHITECTURE.md) — Design da arquitetura de testes determinísticos
- [Plano de Correções](docs/CRITICAL_FIXES_PLAN.md) — Plano original das 14 correções críticas
