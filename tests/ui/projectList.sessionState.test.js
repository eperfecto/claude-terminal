/**
 * Rendering tests for the live session state class on a project row.
 *
 * Each row is tinted by what its Claude tabs are doing: `session-working` while
 * at least one tab is working, `session-idle` once a tab has settled, and
 * nothing at all while every tab is still booting or the project has no tabs.
 * The class is additive — it must never replace `active` (selected by the
 * project filter), `archived` or `path-missing`, which own their own styling.
 */

const { ProjectList } = require('../../src/renderer/ui/components/ProjectList');
const { projectsState, checkMissingPaths } = require('../../src/renderer/state/projects.state');
const { terminalsState } = require('../../src/renderer/state/terminals.state');
const { settingsState } = require('../../src/renderer/state/settings.state');

const fsAccess = window.electron_nodeModules.fs.promises.access;

function project(id, name, extra = {}) {
  return { id, name, path: `/w/${name}`, folderId: null, type: 'general', ...extra };
}

/** Render with a fixed terminal-stats projection keyed by project index. */
function renderWith(statsByIndex, configure) {
  const list = new ProjectList();
  list.setCallbacks({
    getTerminalStatsForProject: (index) => statsByIndex[index] || { total: 0, working: 0, loading: 0 }
  });
  if (configure) configure(list);
  list._renderNow();
  return list;
}

/** Class list of a rendered row. */
function classesOf(projectId) {
  const row = document.querySelector(`.project-item[data-project-id="${projectId}"]`);
  return row ? [...row.classList] : [];
}

beforeEach(async () => {
  document.body.innerHTML = '<div id="projects-list"></div>';

  terminalsState.reset({ terminals: new Map(), activeTerminal: null, detailTerminal: null });

  projectsState.set({
    projects: [project('blog', 'blog'), project('api', 'api')],
    folders: [],
    rootOrder: ['blog', 'api'],
    selectedProjectFilter: null
  });

  settingsState.set({ activeProjectsFirst: false });

  // `_missingPathIds` lives at module scope, so a test that flags a missing
  // path would leak into the next one. Resolving access clears the whole set.
  fsAccess.mockResolvedValue(undefined);
  await checkMissingPaths();
});

describe('project row session state', () => {
  test('carries no session class when the project has no tabs', () => {
    renderWith({});

    // Anchored on a class the row always has: asserting only absences would
    // keep passing if the row stopped rendering altogether.
    expect(classesOf('blog')).toContain('project-item');
    expect(classesOf('blog')).not.toContain('session-working');
    expect(classesOf('blog')).not.toContain('session-idle');
  });

  test('marks a project working when at least one tab is working', () => {
    renderWith({ 0: { total: 2, working: 1, loading: 0 } });

    expect(classesOf('blog')).toContain('session-working');
    expect(classesOf('blog')).not.toContain('session-idle');
  });

  test('marks a project idle when tabs have settled and none are working', () => {
    renderWith({ 0: { total: 2, working: 0, loading: 0 } });

    expect(classesOf('blog')).toContain('session-idle');
    expect(classesOf('blog')).not.toContain('session-working');
  });

  test('stays untinted while every tab is still booting', () => {
    renderWith({ 0: { total: 1, working: 0, loading: 1 } });

    expect(classesOf('blog')).toContain('project-item');
    expect(classesOf('blog')).not.toContain('session-idle');
    expect(classesOf('blog')).not.toContain('session-working');
  });

  test('is idle when one tab boots and another has settled', () => {
    renderWith({ 0: { total: 2, working: 0, loading: 1 } });

    expect(classesOf('blog')).toContain('session-idle');
  });

  test('is working when one tab boots and another works', () => {
    renderWith({ 0: { total: 2, working: 1, loading: 1 } });

    expect(classesOf('blog')).toContain('session-working');
    expect(classesOf('blog')).not.toContain('session-idle');
  });

  test('tolerates stats without a loading count', () => {
    renderWith({ 0: { total: 1, working: 0 } });

    expect(classesOf('blog')).toContain('session-idle');
  });

  test('states are per project, not shared across the list', () => {
    renderWith({ 0: { total: 1, working: 1, loading: 0 }, 1: { total: 1, working: 0, loading: 0 } });

    expect(classesOf('blog')).toContain('session-working');
    expect(classesOf('api')).toContain('session-idle');
  });
});

// Every one of these classes also paints the row. Dropping any of them would
// make a selected project look unselected, or hide a broken-path warning.
describe('session state coexists with the other row classes', () => {
  test('keeps the selected class', () => {
    projectsState.setProp('selectedProjectFilter', 0);

    renderWith({ 0: { total: 1, working: 1, loading: 0 } });

    expect(classesOf('blog')).toContain('active');
    expect(classesOf('blog')).toContain('session-working');
  });

  test('keeps the archived class', () => {
    projectsState.setProp('projects', [project('blog', 'blog', { archived: true }), project('api', 'api')]);

    renderWith({ 0: { total: 1, working: 0, loading: 0 } }, (list) => { list._showArchived = true; });

    expect(classesOf('blog')).toContain('archived');
    expect(classesOf('blog')).toContain('session-idle');
  });

  test('keeps the path-missing class', async () => {
    fsAccess.mockRejectedValue(new Error('ENOENT'));
    await checkMissingPaths();

    renderWith({ 0: { total: 1, working: 1, loading: 0 } });

    expect(classesOf('blog')).toContain('path-missing');
    expect(classesOf('blog')).toContain('session-working');
  });
});
