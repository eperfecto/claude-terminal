/** @jest-environment jsdom */
/**
 * Cloud sessions are server-owned, so every device must see the same list.
 *
 * state.sessions is client memory, and both the chat session bar and the Control
 * view render from it. Restoring a single session at boot was enough to survive
 * a reload on the same device, but a session started on another device never
 * appeared: nothing re-asked the server, and only one session was ever adopted.
 */

const { _syncCloudSessions, _loadCloudTranscript, state, conn } = require('../../remote-ui/app.js');

const live = (id, over = {}) => ({
  id, projectName: 'agrak-http', status: 'running',
  createdAt: 1000, lastActivity: 1000, model: 'claude-sonnet-4-6', ...over,
});

const mockSessions = list => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ sessions: list }),
  }));
};

beforeEach(() => {
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.sessions = {};
  state.selectedSessionId = null;
  state.cloudSessionMode = false;
  state._headlessSessionId = null;
  state.projects = [];
});

test('adopts every live session, not just the newest', async () => {
  mockSessions([live('a'), live('b', { lastActivity: 5000 }), live('c')]);

  await _syncCloudSessions();

  expect(Object.keys(state.sessions).sort())
    .toEqual(['headless-a', 'headless-b', 'headless-c']);
});

test('selects the most recently active one', async () => {
  mockSessions([live('a'), live('b', { lastActivity: 5000 })]);

  await _syncCloudSessions();

  expect(state.selectedSessionId).toBe('headless-b');
  expect(state._headlessSessionId).toBe('b');
  expect(state.cloudSessionMode).toBe(true);
});

test('drops sessions the server no longer reports', async () => {
  mockSessions([live('a'), live('gone')]);
  await _syncCloudSessions();
  expect(state.sessions['headless-gone']).toBeDefined();

  mockSessions([live('a')]);
  await _syncCloudSessions();

  expect(state.sessions['headless-gone']).toBeUndefined();
  expect(state.sessions['headless-a']).toBeDefined();
});

test('keeps a session it already knows instead of recreating it', async () => {
  mockSessions([live('a')]);
  await _syncCloudSessions();
  state.sessions['headless-a'].messages.push({ role: 'user', content: 'hola' });

  await _syncCloudSessions();

  expect(state.sessions['headless-a'].messages).toHaveLength(1);
});

test('binds the project once the project list has loaded', async () => {
  mockSessions([live('a')]);
  await _syncCloudSessions();
  // _makeSession normalises a missing project to null.
  expect(state.sessions['headless-a'].projectId).toBeNull();

  // Projects arrive after the first sync — the session must pick them up.
  state.projects = [{ id: 'cloud-agrak-http', name: 'agrak-http', path: 'agrak-http', _cloud: true }];
  await _syncCloudSessions();

  expect(state.sessions['headless-a'].projectId).toBe('cloud-agrak-http');
});

test('leaves cloud mode off when the server reports nothing', async () => {
  mockSessions([]);

  await _syncCloudSessions();

  expect(state.cloudSessionMode).toBe(false);
  expect(state.selectedSessionId).toBeNull();
});

test('fills an empty session with its transcript', async () => {
  state.sessions['headless-a'] = { sessionId: 'headless-a', messages: [], tabName: 'agrak-http' };
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ messages: [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'buenas' },
    ] }),
  }));

  await _loadCloudTranscript('a');

  expect(state.sessions['headless-a'].messages).toEqual([
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'buenas' },
  ]);
});

test('never overwrites messages already on screen', async () => {
  state.sessions['headless-a'] = {
    sessionId: 'headless-a', messages: [{ role: 'user', content: 'en vivo' }], tabName: 'x',
  };
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ messages: [{ role: 'user', content: 'del disco' }] }),
  }));

  await _loadCloudTranscript('a');

  expect(state.sessions['headless-a'].messages).toEqual([{ role: 'user', content: 'en vivo' }]);
});
