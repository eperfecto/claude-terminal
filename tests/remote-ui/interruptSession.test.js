/** @jest-environment jsdom */
/**
 * Stopping a turn.
 *
 * Every session runs on the cloud server, so its interrupt belongs to the cloud
 * API. With no session adopted there is nothing to interrupt and the PWA must
 * stay quiet rather than firing a request at an id it does not have.
 */

const { state, conn, interruptSession } = require('../../remote-ui/app.js');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  document.body.innerHTML = `
    <div id="screen-auth" class="hidden"></div>
    <div id="screen-main"></div>
    <button id="send-btn"></button>
    <button id="interrupt-btn" class="hidden"></button>
  `;
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  conn.ws = null;

  state.selectedSessionId = 'headless-abc';
  state.activeSessionId = null;
});

test('interrupts a cloud session through the cloud API', async () => {
  state.activeSessionId = 'abc';

  interruptSession();
  await flush();

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('https://cloud.example.com/api/sessions/abc/interrupt');
  expect(opts.method).toBe('POST');
  expect(opts.headers.Authorization).toBe('Bearer ctc_k');
});

test('never shows the auth screen while interrupting', async () => {
  state.activeSessionId = 'abc';

  interruptSession();
  await flush();

  expect(document.getElementById('screen-auth').classList.contains('hidden')).toBe(true);
});

test('sends nothing when no cloud session has been adopted', async () => {
  state.activeSessionId = null;

  interruptSession();
  await flush();

  expect(global.fetch).not.toHaveBeenCalled();
});
