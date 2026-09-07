/** @jest-environment jsdom */
/**
 * Opening a cloud session that this device did not start.
 *
 * Cloud sessions are server-owned and the client persists no messages, so a
 * session opened from the Control list or the session dropdown arrives empty.
 * Its transcript has to be pulled at the moment it is selected — loading it only
 * for the one session picked at boot left every other chat blank.
 */

const { _hydrateSelectedSession, openSession, state, conn } = require('../../remote-ui/app.js');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  document.body.innerHTML = '<div id="chat-messages"></div>';
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.projects = [];
  state.sessions = {
    'headless-abc': { sessionId: 'headless-abc', messages: [], tabName: 'agrak-http', projectId: null },
  };
  state.selectedSessionId = 'headless-abc';
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ messages: [{ role: 'user', content: 'hola' }] }),
  }));
});

test('pulls the transcript of the session being opened', async () => {
  await _hydrateSelectedSession();
  await flush();

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0])
    .toBe('https://cloud.example.com/api/sessions/abc/transcript');
  expect(state.sessions['headless-abc'].messages).toEqual([{ role: 'user', content: 'hola' }]);
});

test('ignores a desktop session, which the desktop replays itself', async () => {
  state.sessions['local-1'] = { sessionId: 'local-1', messages: [] };
  state.selectedSessionId = 'local-1';

  await _hydrateSelectedSession();

  expect(global.fetch).not.toHaveBeenCalled();
});

test('does nothing when no session is selected', async () => {
  state.selectedSessionId = null;

  await _hydrateSelectedSession();

  expect(global.fetch).not.toHaveBeenCalled();
});

test('leaves a session that already has messages untouched', async () => {
  state.sessions['headless-abc'].messages.push({ role: 'user', content: 'en vivo' });

  await _hydrateSelectedSession();
  await flush();

  expect(state.sessions['headless-abc'].messages).toEqual([{ role: 'user', content: 'en vivo' }]);
});

describe('openSession', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="nav-global"></div>
      <div id="view-chat" class="view"></div>
      <div id="session-bar"><select id="session-select"></select></div>
      <div id="chat-messages"></div>`;
  });

  test('hydrates the cloud session it opens', async () => {
    openSession('headless-abc');
    await flush();

    expect(state.selectedSessionId).toBe('headless-abc');
    expect(global.fetch.mock.calls[0][0])
      .toBe('https://cloud.example.com/api/sessions/abc/transcript');
    expect(state.sessions['headless-abc'].messages).toEqual([{ role: 'user', content: 'hola' }]);
  });
});
