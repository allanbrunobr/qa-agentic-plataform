export * from './types/api.ts'
export * from './services/discovery-service.ts'
export * from './services/adapter-service.ts'
export * from './services/execution-store.ts'
export * from './routes/discovery.ts'
export * from './routes/bootstrap.ts'
export * from './routes/review.ts'
export * from './routes/adapters.ts'
export * from './routes/executions.ts'
export * from './routes/sessions.ts'

export const dashboardApiScaffold = {
  purpose: 'serve discovery, bootstrap, adapter selection, execution initialization, and execution history endpoints',
  endpoints: [
    'GET /health',
    'GET /api/adapters',
    'GET /api/adapters/:id/scenarios',
    'GET /api/executions',
    'GET /api/executions/:id',
    'GET /api/sessions',
    'GET /api/sessions/:id',
    'POST /api/discovery',
    'POST /api/bootstrap',
    'POST /api/review',
    'POST /api/executions',
  ],
}
