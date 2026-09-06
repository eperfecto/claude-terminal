/** @jest-environment jsdom */
/**
 * Stopping a turn.
 *
 * A headless cloud session runs on the server with no desktop attached, so its
 * interrupt belongs to the cloud API. Routing it over the relay instead sends a
 * privileged `chat:interrupt`, which wsSend answers by prompting for the
 * desktop's PIN — a login screen in the middle of a cloud chat.
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

  conn.mode = 'relay';
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  conn.relayToken = null;   // no desktop PIN session — the case that used to prompt
  conn.ws = null;

  state.selectedSessionId = 'headless-abc';
  state.cloudSessionMode = false;
  state._headlessSessionId = null;
});

test('interrupts a cloud session through the cloud API', async () => {
  state.cloudSessionMode = true;
  state._headlessSessionId = 'abc';

  interruptSession();
  await flush();

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('https://cloud.example.com/api/sessions/abc/interrupt');
  expect(opts.method).toBe('POST');
  expect(opts.headers.Authorization).toBe('Bearer ctc_k');
});

test('never asks for the desktop PIN while a cloud session is active', async () => {
  state.cloudSessionMode = true;
  state._headlessSessionId = 'abc';

  interruptSession();
  await flush();

  // _promptRelayPin reveals the auth screen; a cloud interrupt must never do that.
  expect(document.getElementById('screen-auth').classList.contains('hidden')).toBe(true);
});

test('still uses the relay when the session belongs to the desktop', async () => {
  state.cloudSessionMode = false;
  state._headlessSessionId = null;

  interruptSession();
  await flush();

  expect(global.fetch).not.toHaveBeenCalled();
  // Without a relay token the desktop path legitimately asks for the PIN.
  expect(document.getElementById('screen-auth').classList.contains('hidden')).toBe(false);
});
