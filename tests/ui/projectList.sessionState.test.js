/**
 * Rendering tests for the live session state class on a project row.
 *
 * Each row is tinted by what its Claude tabs are doing: `session-working` while
 * at least one tab is working, `session-idle` while tabs are open but parked,
 * and nothing at all when the project has no tabs. The class is additive — it
 * must never replace `active`, which on this row means "selected by the project
 * filter" and owns its own styling.
 */

const { ProjectList } = require('../../src/renderer/ui/components/ProjectList');
const { projectsState } = require('../../src/renderer/state/projects.state');
const { terminalsState } = require('../../src/renderer/state/terminals.state');
const { settingsState } = require('../../src/renderer/state/settings.state');

function project(id, name) {
  return { id, name, path: `/w/${name}`, folderId: null, type: 'general' };
}

/** Render with a fixed terminal-stats projection keyed by project index. */
function renderWith(statsByIndex) {
  const list = new ProjectList();
  list.setCallbacks({
    getTerminalStatsForProject: (index) => statsByIndex[index] || { total: 0, working: 0 }
  });
  list._renderNow();
  return list;
}

/** Class list of a rendered row. */
function classesOf(projectId) {
  const row = document.querySelector(`.project-item[data-project-id="${projectId}"]`);
  return row ? [...row.classList] : [];
}

beforeEach(() => {
  document.body.innerHTML = '<div id="projects-list"></div>';

  terminalsState.reset({ terminals: new Map(), activeTerminal: null, detailTerminal: null });

  projectsState.set({
    projects: [project('blog', 'blog'), project('api', 'api')],
    folders: [],
    rootOrder: ['blog', 'api'],
    selectedProjectFilter: null
  });

  settingsState.set({ activeProjectsFirst: false });
});

describe('project row session state', () => {
  test('carries no session class when the project has no tabs', () => {
    renderWith({});

    expect(classesOf('blog')).not.toContain('session-working');
    expect(classesOf('blog')).not.toContain('session-idle');
  });

  test('marks a project working when at least one tab is working', () => {
    renderWith({ 0: { total: 2, working: 1 } });

    expect(classesOf('blog')).toContain('session-working');
    expect(classesOf('blog')).not.toContain('session-idle');
  });

  test('marks a project idle when tabs are open but none are working', () => {
    renderWith({ 0: { total: 2, working: 0 } });

    expect(classesOf('blog')).toContain('session-idle');
    expect(classesOf('blog')).not.toContain('session-working');
  });

  test('states are per project, not shared across the list', () => {
    renderWith({ 0: { total: 1, working: 1 }, 1: { total: 1, working: 0 } });

    expect(classesOf('blog')).toContain('session-working');
    expect(classesOf('api')).toContain('session-idle');
  });

  // `active` and `session-working` both style the background. The row must keep
  // both so CSS decides which wins; dropping either would make a selected
  // project look unselected, or a working project look parked.
  test('keeps the selected class alongside the session class', () => {
    projectsState.setProp('selectedProjectFilter', 0);

    renderWith({ 0: { total: 1, working: 1 } });

    expect(classesOf('blog')).toContain('active');
    expect(classesOf('blog')).toContain('session-working');
  });
});
