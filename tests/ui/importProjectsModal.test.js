/**
 * Bulk import modal.
 *
 * The value of the feature is entirely in what gets selected and registered, so
 * these cover selection defaults, the already-imported guard, the single
 * debounced write for the whole batch, and folder grouping.
 */

const path = require('path');

jest.mock('../../src/renderer/ui/components/ProjectList', () => ({ render: jest.fn() }));
jest.mock('../../src/renderer/ui/components/Toast', () => ({ showSuccess: jest.fn() }));

const { showImportProjectsModal } = require('../../src/renderer/ui/components/ImportProjectsModal');
const { closeModal } = require('../../src/renderer/ui/components/Modal');
const { projectsState, addProject } = require('../../src/renderer/state/projects.state');
const ProjectList = require('../../src/renderer/ui/components/ProjectList');
const Toast = require('../../src/renderer/ui/components/Toast');

const ROOT = path.join('/repos');
const repoAt = (name, extra = {}) => ({
  path: path.join(ROOT, name),
  name,
  isGitRepo: true,
  branch: 'main',
  stack: null,
  ...extra
});

let scanResult;

/** Let the browse -> selectFolder -> scanFolders promise chain settle. */
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function openAndScan(candidates, options = {}) {
  scanResult = { success: true, candidates, truncated: options.truncated || false };
  const modal = showImportProjectsModal(options.modalOptions || {});
  modal.querySelector('#import-browse').click();
  await flush();
  return modal;
}

const rows = (modal) => [...modal.querySelectorAll('.import-check')];
const importButton = (modal) => modal.querySelector('[data-action="import"]');

/** Writes that actually hit disk, i.e. the atomic write's .tmp file. */
function tmpWrites() {
  return window.electron_nodeModules.fs.promises.writeFile.mock.calls
    .filter(call => String(call[0]).endsWith('.tmp'));
}

beforeEach(() => {
  jest.useFakeTimers();
  projectsState.set({ projects: [], folders: [], rootOrder: [] });

  const { fs } = window.electron_nodeModules;
  fs.promises.writeFile.mockClear().mockResolvedValue(undefined);
  fs.promises.rename.mockClear().mockResolvedValue(undefined);
  fs.promises.copyFile.mockClear().mockResolvedValue(undefined);
  fs.promises.access.mockClear().mockResolvedValue(undefined);
  ProjectList.render.mockClear();
  Toast.showSuccess.mockClear();

  window.electron_api.dialog = { selectFolder: jest.fn(async () => ROOT) };
  window.electron_api.project = { scanFolders: jest.fn(async () => scanResult) };
});

afterEach(() => {
  // Dismiss the way the app does: closeModal disconnects the MutationObserver
  // before unmounting. Wiping innerHTML instead tears the node out from under a
  // live observer, which fires the "removed externally" path mid-teardown.
  document.querySelectorAll('.modal-overlay').forEach(closeModal);
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  document.body.innerHTML = '';
});

describe('ImportProjectsModal', () => {
  test('lists every candidate and pre-ticks only the git repos', async () => {
    const modal = await openAndScan([
      repoAt('alpha'),
      repoAt('notes', { isGitRepo: false, branch: null, stack: { type: 'node', label: 'Node.js', color: '#68A063' } })
    ]);

    const checks = rows(modal);
    expect(checks).toHaveLength(2);
    expect(checks[0].checked).toBe(true);
    expect(checks[1].checked).toBe(false);
    expect(importButton(modal).textContent).toContain('1');
  });

  test('disables candidates that are already registered and never imports them', async () => {
    addProject({ name: 'alpha', path: path.join(ROOT, 'alpha') });

    const modal = await openAndScan([repoAt('alpha'), repoAt('beta')]);

    const [alphaCheck, betaCheck] = rows(modal);
    expect(alphaCheck.disabled).toBe(true);
    expect(alphaCheck.checked).toBe(false);
    expect(betaCheck.disabled).toBe(false);

    // Even "select all" must not tick it
    modal.querySelector('#import-select-all').click();
    expect(alphaCheck.checked).toBe(false);

    importButton(modal).click();
    expect(projectsState.get().projects.map(p => p.name)).toEqual(['alpha', 'beta']);
  });

  test('matches an existing project across separator and case differences', async () => {
    addProject({ name: 'alpha', path: 'G:\\Repos\\Alpha' });
    scanResult = { success: true, candidates: [{ path: 'G:/repos/alpha', name: 'alpha', isGitRepo: true, branch: 'main', stack: null }], truncated: false };

    const modal = showImportProjectsModal();
    modal.querySelector('#import-browse').click();
    await flush();

    expect(rows(modal)[0].disabled).toBe(true);
  });

  test('select all / none drives the import button count and disabled state', async () => {
    const modal = await openAndScan([repoAt('a'), repoAt('b'), repoAt('c')]);

    modal.querySelector('#import-select-none').click();
    expect(importButton(modal).disabled).toBe(true);

    modal.querySelector('#import-select-all').click();
    expect(importButton(modal).disabled).toBe(false);
    expect(importButton(modal).textContent).toContain('3');
  });

  test('ticking a row updates the count', async () => {
    const modal = await openAndScan([
      repoAt('a'),
      repoAt('plain', { isGitRepo: false, branch: null })
    ]);

    const plain = rows(modal)[1];
    plain.checked = true;
    plain.dispatchEvent(new Event('change', { bubbles: true }));

    expect(importButton(modal).textContent).toContain('2');
  });

  test('imports the selection in a single debounced write', async () => {
    const modal = await openAndScan([repoAt('a'), repoAt('b'), repoAt('c')]);

    importButton(modal).click();

    const state = projectsState.get();
    expect(state.projects.map(p => p.name)).toEqual(['a', 'b', 'c']);
    expect(state.rootOrder).toHaveLength(3);
    expect(tmpWrites()).toHaveLength(0); // still inside the debounce window

    jest.advanceTimersByTime(600);
    await flush();

    expect(tmpWrites()).toHaveLength(1);
    expect(JSON.parse(tmpWrites()[0][1]).projects).toHaveLength(3);
    expect(ProjectList.render).toHaveBeenCalled();
    expect(Toast.showSuccess).toHaveBeenCalled();
    expect(document.getElementById('import-projects-modal')).toBeNull(); // closed and removed
  });

  test('groups the imported projects into a folder when asked', async () => {
    const modal = await openAndScan([repoAt('a'), repoAt('b')]);

    const toggle = modal.querySelector('#import-group-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    modal.querySelector('#import-group-name').value = 'Work';

    importButton(modal).click();

    const state = projectsState.get();
    expect(state.folders).toHaveLength(1);
    const folder = state.folders[0];
    expect(folder.name).toBe('Work');
    expect(folder.children).toHaveLength(2);
    expect(state.projects.every(p => p.folderId === folder.id)).toBe(true);
    // Grouped projects live in the folder, never also at root
    expect(state.rootOrder).toEqual([folder.id]);
  });

  test('defaults the folder name to the scanned folder basename', async () => {
    const modal = await openAndScan([repoAt('a')]);
    expect(modal.querySelector('#import-group-name').value).toBe(path.basename(ROOT));
  });

  test('hands the imported projects to the caller', async () => {
    const onImported = jest.fn();
    const modal = await openAndScan([repoAt('a')], { modalOptions: { onImported } });

    importButton(modal).click();

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onImported.mock.calls[0][0].map(p => p.name)).toEqual(['a']);
  });

  test('reports a failed scan instead of rendering an empty list', async () => {
    scanResult = { success: false, error: 'Path is not readable' };
    const modal = showImportProjectsModal();
    modal.querySelector('#import-browse').click();
    await flush();

    expect(modal.querySelector('.import-error').textContent).toContain('Path is not readable');
    expect(importButton(modal).disabled).toBe(true);
  });

  test('warns when the scan hit its result cap', async () => {
    const modal = await openAndScan([repoAt('a')], { truncated: true });
    expect(modal.querySelector('.import-warning')).not.toBeNull();
  });

  test('does not scan when the folder picker is dismissed', async () => {
    window.electron_api.dialog.selectFolder = jest.fn(async () => null);
    const modal = showImportProjectsModal();
    modal.querySelector('#import-browse').click();
    await flush();

    expect(window.electron_api.project.scanFolders).not.toHaveBeenCalled();
    expect(modal.querySelector('.import-hint')).not.toBeNull();
  });
});
