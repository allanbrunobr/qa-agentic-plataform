import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { subscribeToRun, unsubscribeFromRun } from '../services/runner.js';
import { getSessionService } from '../phase2/routes/sessions.js';
import { buildContractEvaluation } from '../phase2/services/contract-evaluation.js';

interface WsMessage {
  type: 'log' | 'status' | 'complete' | 'error';
  payload: string | Record<string, unknown>;
  timestamp: string;
}

function sendWsMessage(socket: WebSocket, msg: WsMessage): void {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  } catch {
    // Socket may be closed; ignore send errors
  }
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { runId: string } }>(
    '/ws/runs/:runId',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const runIdRaw = request.params.runId;
      const runId = parseInt(runIdRaw, 10);

      if (isNaN(runId)) {
        sendWsMessage(socket, {
          type: 'error',
          payload: 'Invalid run ID',
          timestamp: new Date().toISOString(),
        });
        socket.close(1008, 'Invalid run ID');
        return;
      }

      const db = getDb();
      const [run] = await db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.id, runId));

      if (!run) {
        sendWsMessage(socket, {
          type: 'error',
          payload: 'Run not found',
          timestamp: new Date().toISOString(),
        });
        socket.close(1008, 'Run not found');
        return;
      }

      // If run is already terminal, send final status immediately
      if (run.status === 'complete' || run.status === 'failed') {
        sendWsMessage(socket, {
          type: 'status',
          payload: { status: run.status, run_id: runId },
          timestamp: new Date().toISOString(),
        });
        sendWsMessage(socket, {
          type: 'complete',
          payload: { status: run.status, run_id: runId },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Subscribe to live log stream
      const logHandler = (line: string): void => {
        sendWsMessage(socket, {
          type: 'log',
          payload: line,
          timestamp: new Date().toISOString(),
        });
      };

      const statusHandler = (status: string): void => {
        sendWsMessage(socket, {
          type: 'status',
          payload: { status, run_id: runId },
          timestamp: new Date().toISOString(),
        });

        if (status === 'complete' || status === 'failed') {
          sendWsMessage(socket, {
            type: 'complete',
            payload: { status, run_id: runId },
            timestamp: new Date().toISOString(),
          });
        }
      };

      subscribeToRun(runId, logHandler, statusHandler);

      socket.on('close', () => {
        unsubscribeFromRun(runId, logHandler, statusHandler);
      });

      socket.on('error', () => {
        unsubscribeFromRun(runId, logHandler, statusHandler);
      });
    }
  );

  app.get<{ Params: { sessionId: string } }>(
    '/ws/p2/sessions/:sessionId',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const { sessionId } = request.params;
      const service = getSessionService();

      const sendSnapshot = () => {
        const session = service.getSession(sessionId);
        if (!session) {
          sendWsMessage(socket, {
            type: 'error',
            payload: 'Session not found',
            timestamp: new Date().toISOString(),
          });
          socket.close(1008, 'Session not found');
          return false;
        }

        sendWsMessage(socket, {
          type: 'status',
          payload: {
            kind: 'phase2_snapshot',
            session: {
              ...session,
              ...buildContractEvaluation(session),
            },
            events: session.events,
            findings: session.findings,
            artifacts: service.listArtifacts(sessionId),
          },
          timestamp: new Date().toISOString(),
        });

        if (session.status === 'complete' || session.status === 'failed') {
          sendWsMessage(socket, {
            type: 'complete',
            payload: {
              kind: 'phase2_complete',
              sessionId,
              status: session.status,
            },
            timestamp: new Date().toISOString(),
          });
        }

        return true;
      };

      if (!sendSnapshot()) return;

      let lastSignature = '';
      const interval = setInterval(() => {
        const session = service.getSession(sessionId);
        if (!session) {
          clearInterval(interval);
          socket.close(1008, 'Session not found');
          return;
        }

        const signature = [
          session.status,
          session.completedAt ?? '',
          session.events.length,
          session.findings.length,
          Object.keys(session.artifacts ?? {}).length,
          session.checkpoint.cursor,
        ].join('|');

        if (signature !== lastSignature) {
          lastSignature = signature;
          sendSnapshot();
        }
      }, 1000);

      socket.on('close', () => clearInterval(interval));
      socket.on('error', () => clearInterval(interval));
    }
  );
}
