/** @jest-environment jsdom */
/**
 * Loading the cloud project list when there is no desktop behind the relay.
 *
 * In 100%-cloud mode the projects live on the server, and the PWA only ever
 * asked for them from the cloud popup's CTA. Dismiss that popup and the project
 * list stayed empty, which in turn left every cloud session without a project
 * to be listed under.
 */

const { _onDesktopOffline, state, conn } = require('../../remote-ui/app.js');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// `t` is a global from i18n.js, which the browser loads as a separate script.
global.t = (key) => key;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="session-bar"><select id="session-select"></select></div>
    <div id="chat-messages"></div>
    <div id="projects-list"></div>`;
  conn.mode = 'relay';
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.projects = [];
  state.folders = [];
  state.rootOrder = [];
  state.desktopOffline = false;
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ projects: [{ name: 'agrak-http', displayName: 'Agrak HTTP' }] }),
  }));
});

test('pulls the cloud projects when the desktop drops off the relay', async () => {
  _onDesktopOffline();
  await flush();

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toBe('https://cloud.example.com/api/projects');
  expect(state.projects).toEqual([
    { id: 'cloud-agrak-http', name: 'Agrak HTTP', path: 'agrak-http', color: '', icon: '', _cloud: true },
  ]);
});

test('asks for nothing when there are no cloud credentials to ask with', async () => {
  conn.cloudApiKey = '';

  _onDesktopOffline();
  await flush();

  expect(global.fetch).not.toHaveBeenCalled();
});
