import { createServer } from 'node:http'
import { URL } from 'node:url'
import { handleAdaptersRequest, handleAdapterScenariosRequest } from './routes/adapters.ts'
import { handleAdapterPromotionRequest, handleAdapterPromotionUpdateRequest } from './routes/adapter-promotion.ts'
import { handleBootstrapRequest } from './routes/bootstrap.ts'
import { handleDiscoveryRequest } from './routes/discovery.ts'
import { handleDiscoverLocalRequest } from './routes/discover-local.ts'
import { handleExecutionDetailRequest, handleExecutionInitRequest, handleExecutionListRequest } from './routes/executions.ts'
import {
  handleGeneratedAdapterFileRequest,
  handleGeneratedAdapterFilesRequest,
  handleGeneratedAdapterFileUpdateRequest,
} from './routes/generated-files.ts'
import { handleInstallLocalRequest } from './routes/install-local.ts'
import { handleMaterializeRequest } from './routes/materialize.ts'
import { handleReviewRequest } from './routes/review.ts'
import { handleSessionDetailRequest, handleSessionListRequest } from './routes/sessions.ts'

const API_PORT = Number(process.env.AGENTIC_PLATFORM_API_PORT ?? 3101)
const WEB_PORT = Number(process.env.AGENTIC_PLATFORM_WEB_PORT ?? 4177)

function sendJson(response: any, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(JSON.stringify(body, null, 2))
}

async function readJsonBody(request: any) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

const server = createServer(async (request: any, response: any) => {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://localhost:${API_PORT}`)

  if (method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    response.end()
    return
  }

  try {
    if (method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'agentic-platform-dashboard-api', port: API_PORT, webPort: WEB_PORT })
      return
    }

    if (method === 'GET' && url.pathname === '/api/adapters') {
      sendJson(response, 200, await handleAdaptersRequest())
      return
    }

    const scenarioMatch = url.pathname.match(/^\/api\/adapters\/([^/]+)\/scenarios$/)
    if (method === 'GET' && scenarioMatch) {
      sendJson(response, 200, await handleAdapterScenariosRequest(decodeURIComponent(scenarioMatch[1])))
      return
    }

    const promotionMatch = url.pathname.match(/^\/api\/adapters\/([^/]+)\/promotion$/)
    if (method === 'GET' && promotionMatch) {
      sendJson(response, 200, await handleAdapterPromotionRequest(decodeURIComponent(promotionMatch[1])))
      return
    }

    if (method === 'POST' && promotionMatch) {
      sendJson(
        response,
        200,
        await handleAdapterPromotionUpdateRequest(decodeURIComponent(promotionMatch[1]), await readJsonBody(request)),
      )
      return
    }

    const generatedFilesMatch = url.pathname.match(/^\/api\/adapters\/([^/]+)\/generated-files$/)
    if (method === 'GET' && generatedFilesMatch) {
      sendJson(response, 200, await handleGeneratedAdapterFilesRequest(decodeURIComponent(generatedFilesMatch[1])))
      return
    }

    const generatedFileMatch = url.pathname.match(/^\/api\/adapters\/([^/]+)\/generated-files\/([^/]+)$/)
    if (method === 'GET' && generatedFileMatch) {
      sendJson(
        response,
        200,
        await handleGeneratedAdapterFileRequest(
          decodeURIComponent(generatedFileMatch[1]),
          decodeURIComponent(generatedFileMatch[2]),
        ),
      )
      return
    }

    if (method === 'POST' && generatedFileMatch) {
      sendJson(
        response,
        200,
        await handleGeneratedAdapterFileUpdateRequest(
          decodeURIComponent(generatedFileMatch[1]),
          decodeURIComponent(generatedFileMatch[2]),
          await readJsonBody(request),
        ),
      )
      return
    }

    if (method === 'GET' && url.pathname === '/api/executions') {
      sendJson(response, 200, await handleExecutionListRequest())
      return
    }

    if (method === 'GET' && url.pathname === '/api/sessions') {
      sendJson(response, 200, await handleSessionListRequest())
      return
    }

    const executionMatch = url.pathname.match(/^\/api\/executions\/([^/]+)$/)
    if (method === 'GET' && executionMatch) {
      sendJson(response, 200, await handleExecutionDetailRequest(decodeURIComponent(executionMatch[1])))
      return
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (method === 'GET' && sessionMatch) {
      sendJson(response, 200, await handleSessionDetailRequest(decodeURIComponent(sessionMatch[1])))
      return
    }


if (method === 'POST' && url.pathname === '/api/install-local') {
  sendJson(response, 200, await handleInstallLocalRequest(await readJsonBody(request)))
  return
}

if (method === 'POST' && url.pathname === '/api/discover-local') {
  sendJson(response, 200, await handleDiscoverLocalRequest(await readJsonBody(request)))
  return
}

    if (method === 'POST' && url.pathname === '/api/discovery') {
      sendJson(response, 200, await handleDiscoveryRequest(await readJsonBody(request)))
      return
    }

    if (method === 'POST' && url.pathname === '/api/bootstrap') {
      sendJson(response, 200, await handleBootstrapRequest(await readJsonBody(request)))
      return
    }

    if (method === 'POST' && url.pathname === '/api/review') {
      sendJson(response, 200, await handleReviewRequest(await readJsonBody(request)))
      return
    }

    if (method === 'POST' && url.pathname === '/api/materialize') {
      sendJson(response, 200, await handleMaterializeRequest(await readJsonBody(request)))
      return
    }

    if (method === 'POST' && url.pathname === '/api/executions') {
      sendJson(response, 200, await handleExecutionInitRequest(await readJsonBody(request)))
      return
    }

    sendJson(response, 404, { error: 'not_found', path: url.pathname })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const statusCode =
      message.startsWith('Scenario restricted by quality gate:')
      || message.startsWith('Adapter promotion blocked by scenario quality signals.')
        ? 409
        : 500
    sendJson(response, statusCode, {
      error: 'internal_error',
      message,
    })
  }
})

server.listen(API_PORT, () => {
  console.log(`agentic-platform dashboard-api listening on http://localhost:${API_PORT}`)
})
