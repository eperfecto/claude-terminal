/**
 * CloudPanel "Subir" (upload project) flow.
 *
 * The button opens a picker listing the local projects and hands the chosen one
 * to the cloud upload IPC. It builds that picker through the Modal component, so
 * it has to honour that component's contract: createModal() returns the overlay
 * ELEMENT and showModal() appends it. Passing an options object to showModal
 * throws inside an async click handler that nobody awaits, which is invisible —
 * the button simply does nothing.
 */

jest.mock('../../src/renderer/ui/components/Toast', () => ({
  show: jest.fn(),
  showSuccess: jest.fn(),
  showError: jest.fn(),
}));

const { settingsState, saveSettings } = require('../../src/renderer/state/settings.state');
const { projectsState } = require('../../src/renderer/state/projects.state');
const CloudPanel = require('../../src/renderer/ui/panels/CloudPanel');

const PROJECTS = [
  { id: 'p-alpha', name: 'alpha', path: '/w/alpha', type: 'general' },
  { id: 'p-beta', name: 'beta', path: '/w/beta', type: 'general' },
];

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

let cloudApi;

const pickerItems = () => [...document.querySelectorAll('.cp-pick-item')];

beforeEach(() => {
  settingsState.set({ cloudServerUrl: 'https://cloud.example.com', cloudApiKey: 'ctc_k' });
  projectsState.set({ projects: PROJECTS });

  const noopUnsub = () => () => {};
  cloudApi = {
    connect: jest.fn().mockResolvedValue({ ok: true }),
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
    checkGitRemote: jest.fn().mockResolvedValue({ hasGitHub: false }),
    uploadProject: jest.fn().mockResolvedValue({ success: true }),
    uploadProjectGit: jest.fn().mockResolvedValue({ success: true, method: 'git-clone' }),
  };
  window.electron_api.cloud = cloudApi;

  document.body.innerHTML = CloudPanel.buildHtml(settingsState.get());
  CloudPanel.setupHandlers({ settingsState, projectsState, saveSettings });
});

afterEach(() => {
  CloudPanel.cleanup();
  document.body.innerHTML = '';
});

test('opens a picker listing every local project', async () => {
  document.getElementById('cp-upload-project-btn').click();
  await flush();

  expect(pickerItems().map(el => el.dataset.id)).toEqual(['p-alpha', 'p-beta']);
});

test('uploads the picked project as a zip when it has no GitHub remote', async () => {
  document.getElementById('cp-upload-project-btn').click();
  await flush();

  pickerItems()[1].click();
  await flush();

  expect(cloudApi.uploadProject).toHaveBeenCalledWith({
    projectId: 'p-beta', projectName: 'beta', projectPath: '/w/beta',
  });
  expect(cloudApi.uploadProjectGit).not.toHaveBeenCalled();
});

test('lets the server clone instead when the project has a GitHub remote', async () => {
  cloudApi.checkGitRemote.mockResolvedValue({ hasGitHub: true });

  document.getElementById('cp-upload-project-btn').click();
  await flush();
  pickerItems()[0].click();
  await flush();

  expect(cloudApi.uploadProjectGit).toHaveBeenCalledWith({
    projectId: 'p-alpha', projectName: 'alpha', projectPath: '/w/alpha',
  });
  expect(cloudApi.uploadProject).not.toHaveBeenCalled();
});

test('closes the picker once a project is chosen', async () => {
  document.getElementById('cp-upload-project-btn').click();
  await flush();
  pickerItems()[0].click();
  await flush();

  // closeModal detaches the overlay after its 200ms exit transition.
  await new Promise(r => setTimeout(r, 260));
  expect(document.querySelector('.cp-pick-list')).toBeNull();
});
