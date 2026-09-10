/** @jest-environment jsdom */
/**
 * The PWA has one transport: the cloud. There is no LAN mode and no relay, so
 * the only socket it may ever open is a per-session stream on the cloud origin.
 */

const { conn, state, _openSessionStream } = require('../../remote-ui/app.js');

beforeEach(() => {
  document.body.innerHTML = `
    <div id="screen-auth" class="hidden"></div>
    <div id="screen-main"></div>
    <div id="auth-cloud-section"></div>
    <input id="cloud-key-input" />
  `;
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  conn.ws = null;
  state.activeSessionId = null;
});

test('conn carries no LAN or relay fields', () => {
  expect(conn).not.toHaveProperty('mode');
  expect(conn).not.toHaveProperty('token');
  expect(conn).not.toHaveProperty('relayToken');
});

test('state carries no desktop-bridge flags', () => {
  expect(state).not.toHaveProperty('desktopOffline');
  expect(state).not.toHaveProperty('cloudSessionMode');
});

test('the session stream targets the cloud origin with the API key', () => {
  const opened = [];
  global.WebSocket = function (url) { opened.push(url); this.close = () => {}; };
  global.WebSocket.OPEN = 1;

  _openSessionStream('sess-1');

  expect(opened).toHaveLength(1);
  expect(opened[0]).toBe(
    'wss://cloud.example.com/api/sessions/sess-1/stream?token=ctc_k'
  );
});

test('the stream is not opened without an API key', () => {
  conn.cloudApiKey = '';
  const opened = [];
  global.WebSocket = function (url) { opened.push(url); this.close = () => {}; };
  global.WebSocket.OPEN = 1;

  _openSessionStream('sess-1');

  expect(opened).toHaveLength(0);
});
