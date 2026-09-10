/** @jest-environment jsdom */
/**
 * Loading the project list at boot.
 *
 * The projects live on the cloud server and nowhere else, so the PWA must ask
 * for them unconditionally. This used to hang off the "desktop is offline"
 * popup's CTA: dismiss that popup and the list stayed empty, which in turn left
 * every cloud session without a project to be listed under.
 */

const { _fetchCloudProjects, state, conn } = require('../../remote-ui/app.js');

// `t` is a global from i18n.js, which the browser loads as a separate script.
global.t = (key) => key;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="session-bar"><select id="session-select"></select></div>
    <div id="chat-messages"></div>
    <div id="projects-list"></div>`;
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
  state.projects = [];
  state.folders = [];
  state.rootOrder = [];
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ projects: [{ name: 'agrak-http', displayName: 'Agrak HTTP' }] }),
  }));
});

test('pulls the project list from the cloud API', async () => {
  await _fetchCloudProjects();

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toBe('https://cloud.example.com/api/projects');
  expect(state.projects).toEqual([
    { id: 'cloud-agrak-http', name: 'Agrak HTTP', path: 'agrak-http', color: '', icon: '', _cloud: true },
  ]);
});

test('asks for nothing when there are no cloud credentials to ask with', async () => {
  conn.cloudApiKey = '';

  await _fetchCloudProjects();

  expect(global.fetch).not.toHaveBeenCalled();
});
