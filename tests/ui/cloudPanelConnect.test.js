/**
 * CloudPanel connect flow.
 *
 * renderer.js renders the panel with `settingsState.get()` but wires its
 * handlers with `{ settingsState, saveSettings }`. The panel must read that
 * same shape: any mismatch throws inside the async click handler, and because
 * the listener neither awaits nor catches it, the rejection is silent — the
 * Connect button looks dead while nothing is persisted and no probe is made.
 */

const { settingsState, saveSettings } = require('../../src/renderer/state/settings.state');
const { projectsState } = require('../../src/renderer/state/projects.state');
const CloudPanel = require('../../src/renderer/ui/panels/CloudPanel');

const SERVER = 'https://cloud.example.com';
const KEY = 'ctc_testkey123';

/** Let the async click handler's promise chain settle. */
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

let cloudApi;

function fillAndConnect({ server = SERVER, key = KEY } = {}) {
  document.getElementById('cp-server-url').value = server;
  document.getElementById('cp-api-key').value = key;
  document.getElementById('cp-connect-form-btn').click();
  return flush();
}

beforeEach(() => {
  settingsState.set({ cloudServerUrl: '', cloudApiKey: '', cloudAutoConnect: true });

  const noopUnsub = () => () => {};
  cloudApi = {
    connect: jest.fn().mockResolvedValue({ ok: true, connected: true }),
    disconnect: jest.fn().mockResolvedValue({ ok: true }),
    status: jest.fn().mockResolvedValue({ connected: false, serverUrl: null }),
    serverHealth: jest.fn().mockResolvedValue({ version: '0.1.0' }),
    onStatusChanged: jest.fn(noopUnsub),
    onUploadProgress: jest.fn(noopUnsub),
    onSyncStatusChanged: jest.fn(noopUnsub),
    onSyncConflict: jest.fn(noopUnsub),
    getUser: jest.fn().mockResolvedValue({}),
    getProjects: jest.fn().mockResolvedValue({ projects: [] }),
    getSessions: jest.fn().mockResolvedValue({ sessions: [] }),
    syncStatus: jest.fn().mockResolvedValue({}),
    getConflicts: jest.fn().mockResolvedValue([]),
  };
  window.electron_api.cloud = cloudApi;

  document.body.innerHTML = CloudPanel.buildHtml(settingsState.get());
  // The exact context renderer.js:3033 passes.
  CloudPanel.setupHandlers({ settingsState, projectsState, saveSettings });
});

afterEach(() => {
  CloudPanel.cleanup();
  document.body.innerHTML = '';
});

test('connects with the credentials typed in the form', async () => {
  await fillAndConnect();

  expect(cloudApi.connect).toHaveBeenCalledWith({ serverUrl: SERVER, apiKey: KEY });
});

test('persists the credentials so a later session can reuse them', async () => {
  await fillAndConnect();

  expect(settingsState.get().cloudServerUrl).toBe(SERVER);
  expect(settingsState.get().cloudApiKey).toBe(KEY);
});

test('refuses to connect when a field is empty, and says so', async () => {
  await fillAndConnect({ key: '' });

  expect(cloudApi.connect).not.toHaveBeenCalled();
  const err = document.getElementById('cp-connect-error');
  expect(err.style.display).not.toBe('none');
  expect(err.textContent.trim()).not.toBe('');
});

test('disconnecting clears auto-connect so the app does not redial on boot', async () => {
  await fillAndConnect();
  document.getElementById('cp-status-pill').classList.add('connected');

  document.getElementById('cp-connect-btn').click();
  await flush();

  expect(cloudApi.disconnect).toHaveBeenCalled();
  expect(settingsState.get().cloudAutoConnect).toBe(false);
});
