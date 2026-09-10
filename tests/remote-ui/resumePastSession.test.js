/** @jest-environment jsdom */
/**
 * Resuming an old conversation from the history list.
 *
 * Resuming spawns a brand-new cloud session with `resume` pointed at the old
 * transcript, so the agent remembers everything and the phone remembers nothing:
 * the chat opened with a single "continue" line and no sign of what was being
 * continued. The history has to be pulled in beside it.
 */

const { _startHeadlessSession, state, conn } = require('../../remote-ui/app.js');

global.t = (key) => key;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="session-bar"><select id="session-select"></select></div>
    <div id="chat-messages"></div>
    <button id="send-btn"></button>
    <button id="interrupt-btn"></button>`;
  global.WebSocket = class { constructor() { this.readyState = 0; } close() {} addEventListener() {} };
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.projects = [{ id: 'cloud-agrak-http', name: 'Agrak HTTP', path: 'agrak-http', _cloud: true }];
  state.sessions = {};
  state.selectedSessionId = null;

  global.fetch = jest.fn((url) => {
    if (String(url).endsWith('/api/sessions')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ sessionId: 'new-cloud-1' }) });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        messages: [
          { role: 'user', content: 'como levanto el server?' },
          { role: 'assistant', content: 'npm start' },
        ],
      }),
    });
  });
});

test('opens the resumed chat with the conversation it is continuing', async () => {
  await _startHeadlessSession('agrak-http', 'Continue from where we left off.', 'sdk-old');

  expect(global.fetch.mock.calls.map(c => String(c[0]))).toContain(
    'https://cloud.example.com/api/sessions/sdk-old/transcript',
  );
  expect(state.sessions['headless-new-cloud-1'].messages).toEqual([
    { role: 'user', content: 'como levanto el server?' },
    { role: 'assistant', content: 'npm start' },
    { role: 'user', content: 'Continue from where we left off.' },
  ]);
});

test('asks for no transcript when the session is a fresh one', async () => {
  await _startHeadlessSession('agrak-http', 'hola');

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(state.sessions['headless-new-cloud-1'].messages).toEqual([
    { role: 'user', content: 'hola' },
  ]);
});
