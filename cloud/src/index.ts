import http from 'http';
import path from 'path';
import express from 'express';
import { config } from './config';
import { store } from './store/store';
import { createCloudRouter } from './cloud/CloudAPI';
import { sessionManager } from './cloud/SessionManager';
import { authenticateApiKey, buildKeyIndex } from './auth/auth';
import { WebSocket, WebSocketServer } from 'ws';

// ── In-memory circular log buffer for admin TUI ──
const MAX_LOG_ENTRIES = 500;
const _logRing: Array<{ timestamp: number; level: string; message: string } | null> = new Array(MAX_LOG_ENTRIES).fill(null);
let _logHead = 0;
let _logCount = 0;

function captureLog(level: string, ...args: any[]): void {
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  _logRing[_logHead] = { timestamp: Date.now(), level, message };
  _logHead = (_logHead + 1) % MAX_LOG_ENTRIES;
  if (_logCount < MAX_LOG_ENTRIES) _logCount++;
}

/** Return logs in chronological order */
function getLogBuffer(): Array<{ timestamp: number; level: string; message: string }> {
  if (_logCount < MAX_LOG_ENTRIES) {
    return _logRing.slice(0, _logCount) as any;
  }
  return [..._logRing.slice(_logHead), ..._logRing.slice(0, _logHead)] as any;
}

// Intercept console.log/warn/error to capture logs
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origErr = console.error.bind(console);

console.log = (...args: any[]) => { captureLog('INFO', ...args); _origLog(...args); };
console.warn = (...args: any[]) => { captureLog('WARN', ...args); _origWarn(...args); };
console.error = (...args: any[]) => { captureLog('ERROR', ...args); _origErr(...args); };

export async function startServer(): Promise<void> {
  await store.ensureDataDirs();
  await store.getServerData(); // Init server.json if needed
  await buildKeyIndex(); // Build hash->user index + migrate plaintext keys

  const app = express();

  // ── CORS ──
  app.use((_req, res, next) => {
    const allowed = config.corsOrigins;
    if (allowed === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      const origin = _req.headers.origin;
      if (origin && allowed.split(',').map(s => s.trim()).includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: require('../package.json').version,
      cloud: config.cloudEnabled,
    });
  });

  // ── Admin endpoints (protected by ADMIN_TOKEN) ──

  app.use('/admin', (req, res, next) => {
    if (!config.adminToken) {
      res.status(403).json({ error: 'Admin endpoints disabled (ADMIN_TOKEN not set)' });
      return;
    }
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token !== config.adminToken) {
      res.status(401).json({ error: 'Invalid admin token' });
      return;
    }
    next();
  });

  app.get('/admin/logs', (_req, res) => {
    res.json(getLogBuffer());
  });

  const server = http.createServer(app);

  // Cloud API routes
  app.use('/api', createCloudRouter());

  // API 404 (before SPA fallback)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Remote UI (PWA static files)
  const remoteUiDir = path.join(__dirname, '..', 'remote-ui');
  app.use(express.static(remoteUiDir));
  // SPA fallback: serve index.html for unknown routes
  app.use((_req, res) => {
    res.sendFile(path.join(remoteUiDir, 'index.html'));
  });

  sessionManager.start();

  // Session stream WS (handles /api/sessions/:id/stream upgrade)
  const sessionWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // /api/sessions/:id/stream
    const streamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
    if (streamMatch) {
      const sessionId = streamMatch[1];
      const token = url.searchParams.get('token');
      console.log(`[WS Upgrade] Session stream request for ${sessionId}, hasToken=${!!token}`);

      if (!token) {
        console.log(`[WS Upgrade] No token, destroying socket`);
        socket.destroy();
        return;
      }

      authenticateApiKey(token).then(userName => {
        if (!userName || !sessionManager.isUserSession(sessionId, userName)) {
          console.log(`[WS Upgrade] Auth failed or session not owned: user=${userName}`);
          socket.destroy();
          return;
        }

        console.log(`[WS Upgrade] Auth OK for user=${userName}, upgrading...`);
        sessionWss.handleUpgrade(req, socket, head, ws => {
          const ok = sessionManager.addStreamClient(sessionId, ws);
          if (!ok) {
            console.log(`[WS Upgrade] Session ${sessionId} not found after upgrade`);
            ws.close(4004, 'Session not found');
          }
        });
      }).catch((err) => { console.error(`[WS Upgrade] Auth error:`, err); socket.destroy(); });
      return;
    }

    // Unknown upgrade path
    console.log(`[WS Upgrade] Unknown path: ${url.pathname}, destroying`);
    socket.destroy();
  });

  server.listen(config.port, config.host, () => {
    console.log('');
    console.log(`  Claude Terminal Cloud v${require('../package.json').version}`);
    if (config.cloudEnabled) {
      console.log(`  API:    http://${config.host}:${config.port}/api`);
    }
    console.log(`  Health: http://${config.host}:${config.port}/health`);
    if (!config.adminToken) {
      console.log(`  Admin:  disabled (set ADMIN_TOKEN to enable /admin endpoints)`);
    }
    console.log('');
  });

  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err.message);
  });
  process.on('unhandledRejection', (err: any) => {
    console.error('[FATAL] Unhandled rejection:', err?.message || err);
  });
}

// If run directly (not imported by CLI)
if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}
