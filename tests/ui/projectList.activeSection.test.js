/**
 * Rendering tests for the "active sessions" section of the project list.
 *
 * The section is a render-time projection: projects with an open terminal tab
 * (Claude session or plain shell) are hoisted into a flat block on top and
 * skipped in the tree, while rootOrder and the folder hierarchy stay untouched.
 */

const { ProjectList } = require('../../src/renderer/ui/components/ProjectList');
const { projectsState } = require('../../src/renderer/state/projects.state');
const { terminalsState, addTerminal } = require('../../src/renderer/state/terminals.state');
const { settingsState } = require('../../src/renderer/state/settings.state');

function project(id, name, folderId = null) {
  return { id, name, path: `/w/${name}`, folderId, type: 'general' };
}

function claudeTab(projectId, createdAt) {
  return {
    project: { id: projectId, name: projectId, path: `/w/${projectId}` },
    isBasic: false,
    mode: 'terminal',
    status: 'ready',
    createdAt
  };
}

/** Project ids in DOM order, scoped to a selector. */
function idsIn(selector) {
  const root = selector ? document.querySelector(selector) : document.getElementById('projects-list');
  if (!root) return [];
  return [...root.querySelectorAll('.project-item')].map(el => el.dataset.projectId);
}

/** Project ids rendered in the tree (everything outside the hoisted section). */
function idsInTree() {
  const list = document.getElementById('projects-list');
  return [...list.querySelectorAll('.project-item')]
    .filter(el => !el.closest('.active-projects-section'))
    .map(el => el.dataset.projectId);
}

let list;

beforeEach(() => {
  document.body.innerHTML = '<div id="projects-list"></div>';
  list = document.getElementById('projects-list');

  terminalsState.reset({ terminals: new Map(), activeTerminal: null, detailTerminal: null });

  // "work" folder holds api; blog and dashboard sit at root
  projectsState.set({
    projects: [project('blog', 'blog'), project('api', 'api', 'f1'), project('dashboard', 'dashboard')],
    folders: [{ id: 'f1', name: 'work', parentId: null, children: ['api'], collapsed: false }],
    rootOrder: ['blog', 'f1', 'dashboard']
  });

  settingsState.set({ activeProjectsFirst: true });
});

describe('active sessions section', () => {
  test('is absent when the setting is off, leaving the tree untouched', () => {
    settingsState.set({ activeProjectsFirst: false });
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();

    expect(list.querySelector('.active-projects-section')).toBeNull();
    expect(idsInTree()).toEqual(['blog', 'api', 'dashboard']);
  });

  test('is absent when no project has a Claude session', () => {
    new ProjectList()._renderNow();

    expect(list.querySelector('.active-projects-section')).toBeNull();
    expect(idsInTree()).toEqual(['blog', 'api', 'dashboard']);
  });

  test('hoists a root project out of the tree', () => {
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();

    expect(idsIn('.active-projects-section')).toEqual(['blog']);
    expect(idsInTree()).toEqual(['api', 'dashboard']);
  });

  test('hoists a project out of its folder', () => {
    addTerminal(1, claudeTab('api', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();

    expect(idsIn('.active-projects-section')).toEqual(['api']);
    expect(idsInTree()).toEqual(['blog', 'dashboard']);
    // The folder itself survives being emptied
    expect(list.querySelector('.folder-item[data-folder-id="f1"]')).not.toBeNull();
  });

  test('reaches into a collapsed folder', () => {
    projectsState.set({
      folders: [{ id: 'f1', name: 'work', parentId: null, children: ['api'], collapsed: true }]
    });
    addTerminal(1, claudeTab('api', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();

    expect(idsIn('.active-projects-section')).toEqual(['api']);
  });

  test('orders the section with the most recent session first', () => {
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));
    addTerminal(2, claudeTab('api', '2026-01-01T11:00:00.000Z'));
    addTerminal(3, claudeTab('dashboard', '2026-01-01T12:00:00.000Z'));

    new ProjectList()._renderNow();

    expect(idsIn('.active-projects-section')).toEqual(['dashboard', 'api', 'blog']);
    expect(idsInTree()).toEqual([]);
  });

  test('renders hoisted rows flat, without folder indentation', () => {
    addTerminal(1, claudeTab('api', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();

    const row = document.querySelector('.active-projects-section .project-item');
    expect(row.dataset.depth).toBe('0');
  });

  test('shows how many sessions are active', () => {
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));
    addTerminal(2, claudeTab('api', '2026-01-01T11:00:00.000Z'));

    new ProjectList()._renderNow();

    expect(document.querySelector('.active-projects-count').textContent.trim()).toBe('2');
  });

  test('hoists a project with only a basic (non-Claude) terminal', () => {
    addTerminal(1, { ...claudeTab('blog', '2026-01-01T10:00:00.000Z'), isBasic: true });

    new ProjectList()._renderNow();

    expect(idsIn('.active-projects-section')).toEqual(['blog']);
    expect(idsInTree()).toEqual(['api', 'dashboard']);
  });

  test('returns the project to its exact tree position when the session closes', () => {
    addTerminal(1, claudeTab('api', '2026-01-01T10:00:00.000Z'));
    new ProjectList()._renderNow();
    expect(idsInTree()).toEqual(['blog', 'dashboard']);

    terminalsState.reset({ terminals: new Map(), activeTerminal: null, detailTerminal: null });
    new ProjectList()._renderNow();

    expect(list.querySelector('.active-projects-section')).toBeNull();
    expect(idsInTree()).toEqual(['blog', 'api', 'dashboard']);
  });

  test('never mutates rootOrder or the folder hierarchy', () => {
    addTerminal(1, claudeTab('api', '2026-01-01T10:00:00.000Z'));
    addTerminal(2, claudeTab('blog', '2026-01-01T11:00:00.000Z'));

    new ProjectList()._renderNow();

    const state = projectsState.get();
    expect(state.rootOrder).toEqual(['blog', 'f1', 'dashboard']);
    expect(state.folders[0].children).toEqual(['api']);
    expect(state.projects.find(p => p.id === 'api').folderId).toBe('f1');
  });

  test('applies the same tag filter as the tree', () => {
    projectsState.set({
      projects: [
        { ...project('blog', 'blog'), tags: ['x'] },
        project('api', 'api', 'f1'),
        project('dashboard', 'dashboard')
      ]
    });
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));
    addTerminal(2, claudeTab('api', '2026-01-01T11:00:00.000Z'));

    const pl = new ProjectList();
    pl._selectedTagFilter = 'x';
    pl._renderNow();

    // api has no matching tag, so it is filtered out of the section too
    expect(idsIn('.active-projects-section')).toEqual(['blog']);
  });

  test('hides archived projects from the section unless archived are shown', () => {
    projectsState.set({
      projects: [
        { ...project('blog', 'blog'), archived: true },
        project('api', 'api', 'f1'),
        project('dashboard', 'dashboard')
      ]
    });
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();
    expect(list.querySelector('.active-projects-section')).toBeNull();

    const pl = new ProjectList();
    pl._showArchived = true;
    pl._renderNow();
    expect(idsIn('.active-projects-section')).toEqual(['blog']);
  });

  test('labels the tree below the section with a "Projects" heading', () => {
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();

    const heading = list.querySelector('.projects-section-header .projects-section-title');
    expect(heading).not.toBeNull();
    // The heading divides the two groups, so it must come after the section
    expect(
      list.querySelector('.active-projects-section')
        .compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test('omits the heading when nothing is hoisted', () => {
    new ProjectList()._renderNow();

    expect(list.querySelector('.active-projects-section')).toBeNull();
    expect(list.querySelector('.projects-section-header')).toBeNull();
  });

  test('omits the heading when every project was hoisted', () => {
    projectsState.set({
      projects: [project('blog', 'blog')],
      folders: [],
      rootOrder: ['blog']
    });
    addTerminal(1, claudeTab('blog', '2026-01-01T10:00:00.000Z'));

    new ProjectList()._renderNow();

    expect(idsIn('.active-projects-section')).toEqual(['blog']);
    expect(list.querySelector('.projects-section-header')).toBeNull();
  });
});
