/** @jest-environment jsdom */
/**
 * Sessions whose process died with a server restart.
 *
 * The server now reports them as `resumable` instead of forgetting them, so the
 * phone must stop pruning them — that pruning is what the user saw as an update
 * deleting their sessions. But it must not treat them as live either: a resumable
 * session cannot receive a message, so adopting one as the active session would
 * send prompts into the void.
 */

const { state, conn, _syncCloudSessions, sendMessage } = require('../../remote-ui/app.js');

global.t = (key) => key;

const mockSessions = (list) => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ sessions: list }),
  }));
};

const session = (id, over = {}) => ({
  id,
  projectName: 'agrak-http',
  status: 'running',
  createdAt: 1000,
  lastActivity: 1000,
  model: 'claude-sonnet-4-6',
  ...over,
});

const resumable = (id, over = {}) => session(id, {
  status: 'resumable',
  sdkSessionId: `sdk-${id}`,
  ...over,
});

beforeEach(() => {
  document.body.innerHTML = `
    <div id="session-bar"><select id="session-select"></select></div>
    <div id="chat-messages"></div>
    <div id="projects-list"></div>`;
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.sessions = {};
  state.selectedSessionId = null;
  state.activeSessionId = null;
  state.projects = [{ id: 'cloud-agrak-http', name: 'agrak-http', path: 'agrak-http', _cloud: true }];
});

test('keeps a resumable session instead of pruning it off the screen', async () => {
  mockSessions([resumable('a')]);

  await _syncCloudSessions();

  expect(state.sessions['headless-a']).toBeDefined();
  expect(state.sessions['headless-a'].resumable).toBe(true);
});

test('carries the sdk id, the only key a resume can be started from', async () => {
  mockSessions([resumable('a')]);

  await _syncCloudSessions();

  expect(state.sessions['headless-a'].sdkSessionId).toBe('sdk-a');
});

test('does not adopt a resumable session as the active one', async () => {
  mockSessions([resumable('a')]);

  await _syncCloudSessions();

  expect(state.activeSessionId).toBeNull();
});

test('still adopts a live session as the active one', async () => {
  mockSessions([session('live-1')]);

  await _syncCloudSessions();

  expect(state.activeSessionId).toBe('live-1');
  expect(state.sessions['headless-live-1'].resumable).toBeFalsy();
});

test('prefers a live session over a more recent resumable one', async () => {
  mockSessions([session('live-1', { lastActivity: 1000 }), resumable('dead', { lastActivity: 9999 })]);

  await _syncCloudSessions();

  expect(state.activeSessionId).toBe('live-1');
});

test('still drops a session the server no longer reports at all', async () => {
  state.sessions['headless-gone'] = { sessionId: 'headless-gone', messages: [] };
  mockSessions([session('live-1')]);

  await _syncCloudSessions();

  expect(state.sessions['headless-gone']).toBeUndefined();
});

test('a session that came back to life stops being marked resumable', async () => {
  mockSessions([resumable('a')]);
  await _syncCloudSessions();
  expect(state.sessions['headless-a'].resumable).toBe(true);

  mockSessions([session('a')]);
  await _syncCloudSessions();

  expect(state.sessions['headless-a'].resumable).toBe(false);
  expect(state.activeSessionId).toBe('a');
});

/**
 * Writing into a session the server restarted.
 *
 * The whole point of keeping it on screen is that its conversation is recoverable.
 * Starting a fresh session instead would throw away the transcript we went to the
 * trouble of surfacing.
 */
describe('sending into a resumable session', () => {
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  beforeEach(() => {
    document.body.innerHTML += `
      <textarea id="chat-input">seguimos</textarea>
      <button id="send-btn"></button>
      <button id="interrupt-btn" class="hidden"></button>`;
    state.selectedProjectId = 'cloud-agrak-http';
  });

  test('resumes the conversation with its sdk id instead of starting a new one', async () => {
    state.sessions['headless-a'] = {
      sessionId: 'headless-a', messages: [], resumable: true, sdkSessionId: 'sdk-a',
      projectId: 'cloud-agrak-http', tabName: 'agrak-http',
    };
    state.selectedSessionId = 'headless-a';
    state.activeSessionId = null;
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ sessionId: 'new-1' }),
    }));

    sendMessage();
    await flush();

    const posts = global.fetch.mock.calls.filter(([url]) => url.endsWith('/api/sessions'));
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0][1].body);
    expect(body.resumeSessionId).toBe('sdk-a');
    expect(body.prompt).toBe('seguimos');
  });

  test('retires the session it resumed from, so it is not listed twice', async () => {
    // The conversation moves to the new id. Leaving the old entry on screen shows
    // the same chat twice until the next sync happens to prune it.
    state.sessions['headless-a'] = {
      sessionId: 'headless-a', messages: [], resumable: true, sdkSessionId: 'sdk-a',
      projectId: 'cloud-agrak-http', tabName: 'agrak-http',
    };
    state.selectedSessionId = 'headless-a';
    state.activeSessionId = null;
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ sessionId: 'new-1', messages: [] }),
    }));

    sendMessage();
    await flush();

    expect(state.sessions['headless-a']).toBeUndefined();
    expect(state.sessions['headless-new-1']).toBeDefined();
  });
});
