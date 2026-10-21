type Request = { body?: unknown }
type Response = { status: (code: number) => Response; json: (body: unknown) => void }
type App = { post: (path: string, handler: (request: Request, response: Response) => void) => void }

export function registerOrderRoutes(app: App) {
  app.post('/api/orders', (_request, response) => {
    response.status(201).json({ ok: true })
  })
}
