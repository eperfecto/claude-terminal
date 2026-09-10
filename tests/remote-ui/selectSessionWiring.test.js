/** @jest-environment jsdom */
/**
 * Every way of opening a cloud session has to pull its transcript.
 *
 * hydrateSession.test.js already asserts that opening one loads it, but it calls
 * openSession() directly — so it passed while two of the three controls that
 * actually open a session never called anything of the sort. A session opened
 * from Control or from the session dropdown came up blank, and only started
 * showing anything once the user wrote into it.
 *
 * These tests drive the real controls, because the defect was the wiring.
 */

const { renderControlView, renderSessionBar, state, conn } = require('../../remote-ui/app.js');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// `t` is a global from i18n.js, which the browser loads as a separate script.
global.t = (key) => key;

const transcriptCalls = () =>
  global.fetch.mock.calls.filter(([url]) => String(url).includes('/transcript'));

beforeEach(() => {
  document.body.innerHTML = `
    <div id="chat-messages"></div>
    <div id="session-bar"><select id="session-select"></select></div>
    <div id="control-list"></div>
    <div id="control-empty" class="hidden"></div>
    <span id="control-count"></span>
    <div id="view-chat" class="view"></div>`;
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.projects = [];
  state.selectedProjectId = null;
  state.inProjectHub = false;
  state.sessions = {
    'headless-abc': { sessionId: 'headless-abc', messages: [], tabName: 'agrak-http', projectId: null, status: 'idle' },
    'headless-def': { sessionId: 'headless-def', messages: [], tabName: 'otro', projectId: null, status: 'idle' },
  };
  state.selectedSessionId = 'headless-def';
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ messages: [{ role: 'user', content: 'hola' }] }),
  }));
});

test('opening a session from Control pulls its transcript', async () => {
  renderControlView();

  document.querySelector('.control-card[data-session-id="headless-abc"]').click();
  await flush();

  expect(transcriptCalls()).toHaveLength(1);
  expect(transcriptCalls()[0][0]).toContain('/api/sessions/abc/transcript');
  expect(state.sessions['headless-abc'].messages).toHaveLength(1);
});

test('switching session in the dropdown pulls its transcript', async () => {
  renderSessionBar();

  const select = document.getElementById('session-select');
  select.value = 'headless-abc';
  select.dispatchEvent(new Event('change'));
  await flush();

  expect(transcriptCalls()).toHaveLength(1);
  expect(state.sessions['headless-abc'].messages).toHaveLength(1);
});

test('does not re-fetch a session that already has its messages', async () => {
  state.sessions['headless-abc'].messages = [{ role: 'user', content: 'ya estaba' }];
  renderControlView();

  document.querySelector('.control-card[data-session-id="headless-abc"]').click();
  await flush();

  expect(transcriptCalls()).toHaveLength(0);
});
