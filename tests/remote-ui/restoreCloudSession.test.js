/** @jest-environment jsdom */
/**
 * Surviving a reload with a cloud session open.
 *
 * _saveSessions() is a deliberate no-op: the desktop replays its sessions on
 * reconnect, so the client stores nothing. A headless cloud session has no
 * desktop to replay it — cloudSessionMode and _headlessSessionId live only in
 * memory, so a refresh orphaned a session that was still running on the server.
 *
 * The server lists live sessions (GET /api/sessions), so the client can find its
 * way back to one.
 */

const { _pickResumableSession, _restoreCloudSession, state, conn } = require('../../remote-ui/app.js');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const session = (id, over = {}) => ({
  id, projectName: 'agrak-http', status: 'running',
  createdAt: 1000, lastActivity: 1000, model: 'claude-sonnet-4-6', ...over,
});

beforeEach(() => {
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.sessions = {};
  state.selectedSessionId = null;
  state.cloudSessionMode = false;
  state._headlessSessionId = null;
  state.projects = [{ id: 'cloud-agrak-http', name: 'agrak-http', path: 'agrak-http', _cloud: true }];
});

describe('picking which session to resume', () => {
  test('returns nothing when the server lists none', () => {
    expect(_pickResumableSession([])).toBeNull();
    expect(_pickResumableSession(undefined)).toBeNull();
  });

  test('resumes the only live session', () => {
    expect(_pickResumableSession([session('a')]).id).toBe('a');
  });

  test('prefers the most recently active when several are live', () => {
    const picked = _pickResumableSession([
      session('old', { lastActivity: 500 }),
      session('newest', { lastActivity: 9000 }),
      session('mid', { lastActivity: 3000 }),
    ]);
    expect(picked.id).toBe('newest');
  });

  test('falls back to createdAt when a session never reported activity', () => {
    const picked = _pickResumableSession([
      session('a', { lastActivity: null, createdAt: 100 }),
      session('b', { lastActivity: null, createdAt: 700 }),
    ]);
    expect(picked.id).toBe('b');
  });
});

describe('reattaching after a reload', () => {
  test('puts the client back into cloud session mode', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ sessions: [session('abc')] }),
    }));

    await _restoreCloudSession();
    await flush();

    expect(state.cloudSessionMode).toBe(true);
    expect(state._headlessSessionId).toBe('abc');
    expect(state.selectedSessionId).toBe('headless-abc');
    expect(state.sessions['headless-abc']).toBeDefined();
    expect(state.sessions['headless-abc'].tabName).toBe('agrak-http');
  });

  test('leaves the client alone when nothing is running', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ sessions: [] }),
    }));

    await _restoreCloudSession();
    await flush();

    expect(state.cloudSessionMode).toBe(false);
    expect(state._headlessSessionId).toBeNull();
  });

  test('stays quiet when the server cannot be reached', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));

    await expect(_restoreCloudSession()).resolves.toBeUndefined();
    expect(state.cloudSessionMode).toBe(false);
  });
});
