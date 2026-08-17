// scan-project-folders IPC handler — the directory walk behind bulk import.
//
// The walk has to be right on the tricky cases or it either misses repos or
// drowns the user in nested sub-packages: stop descending once a directory is
// a project, treat a worktree's `.git` FILE as a repo, and never follow a
// symlink.

const path = require('path');

// ─── Virtual filesystem ─────────────────────────────────────────────────────
// dirPath -> [{ name, kind: 'dir'|'file'|'link' }]
const mockTree = new Map();
// filePath -> contents
const mockFiles = new Map();
// dirs that blow up on readdir (permissions)
const mockUnreadable = new Set();

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() }
}));

jest.mock('../../src/main/utils/paths', () => ({
  projectsFile: '/mock/data/projects.json'
}));

jest.mock('fs', () => ({
  promises: {
    stat: async (p) => {
      if (mockTree.has(p)) return { isDirectory: () => true, isFile: () => false };
      if (mockFiles.has(p)) return { isDirectory: () => false, isFile: () => true };
      const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err;
    },
    readdir: async (dir) => {
      if (mockUnreadable.has(dir)) {
        const err = new Error('EACCES'); err.code = 'EACCES'; throw err;
      }
      if (!mockTree.has(dir)) {
        const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err;
      }
      return mockTree.get(dir).map(entry => ({
        name: entry.name,
        isDirectory: () => entry.kind === 'dir',
        isSymbolicLink: () => entry.kind === 'link'
      }));
    },
    readFile: async (p) => {
      if (!mockFiles.has(p)) {
        const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err;
      }
      return mockFiles.get(p);
    }
  },
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  renameSync: jest.fn()
}));

const { ipcMain } = require('electron');
const { registerProjectHandlers } = require('../../src/main/ipc/project.ipc');

const handlers = {};
beforeAll(() => {
  ipcMain.handle.mockImplementation((channel, handler) => { handlers[channel] = handler; });
  registerProjectHandlers();
});

// Resolved up front so every key matches what path.resolve() produces on this
// platform — the handler resolves its input before walking.
const ROOT = path.resolve('/repos');
const at = (...segments) => path.join(ROOT, ...segments);

/** Declare a directory and its entries. */
function dir(dirPath, entries = []) {
  mockTree.set(dirPath, entries);
}
/** Declare a file with optional contents. */
function file(filePath, contents = '') {
  mockFiles.set(filePath, contents);
}
/** Shorthand: a git clone at `segments` containing the given extra entries. */
function repo(segments, extra = [], branch = 'main') {
  const repoPath = at(...segments);
  dir(repoPath, [{ name: '.git', kind: 'dir' }, ...extra]);
  dir(path.join(repoPath, '.git'), [{ name: 'HEAD', kind: 'file' }]);
  file(path.join(repoPath, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  return repoPath;
}

const scan = (params) => handlers['scan-project-folders'](null, params);
const namesOf = (result) => result.candidates.map(c => c.name).sort();

beforeEach(() => {
  mockTree.clear();
  mockFiles.clear();
  mockUnreadable.clear();
});

describe('scan-project-folders', () => {
  test('rejects a root that is not a readable directory', async () => {
    expect(await scan({ rootPath: '' })).toEqual({ success: false, error: 'Invalid root path' });
    expect((await scan({ rootPath: at('nope') })).success).toBe(false);

    file(at('a-file'));
    dir(ROOT, [{ name: 'a-file', kind: 'file' }]);
    expect(await scan({ rootPath: at('a-file') })).toEqual({ success: false, error: 'Not a directory' });
  });

  test('finds git repos directly under the root, with their branch', async () => {
    dir(ROOT, [{ name: 'alpha', kind: 'dir' }, { name: 'beta', kind: 'dir' }]);
    repo(['alpha'], [], 'main');
    repo(['beta'], [], 'feature/x');

    const result = await scan({ rootPath: ROOT });

    expect(result.success).toBe(true);
    expect(namesOf(result)).toEqual(['alpha', 'beta']);
    expect(result.candidates.find(c => c.name === 'beta')).toMatchObject({
      path: at('beta'),
      isGitRepo: true,
      branch: 'feature/x'
    });
  });

  test('finds repos nested one org level down', async () => {
    dir(ROOT, [{ name: 'acme', kind: 'dir' }]);
    dir(at('acme'), [{ name: 'service', kind: 'dir' }]);
    repo(['acme', 'service']);

    const result = await scan({ rootPath: ROOT });

    expect(namesOf(result)).toEqual(['service']);
    expect(result.candidates[0].path).toBe(at('acme', 'service'));
  });

  test('stops descending once a directory is a project', async () => {
    // A monorepo: the inner packages are its source tree, not separate imports.
    dir(ROOT, [{ name: 'mono', kind: 'dir' }]);
    repo(['mono'], [{ name: 'packages', kind: 'dir' }]);
    dir(at('mono', 'packages'), [{ name: 'inner', kind: 'dir' }]);
    repo(['mono', 'packages', 'inner']);

    const result = await scan({ rootPath: ROOT });

    expect(namesOf(result)).toEqual(['mono']);
  });

  test('treats a worktree, whose .git is a file, as a repo', async () => {
    dir(ROOT, [{ name: 'wt', kind: 'dir' }]);
    dir(at('wt'), [{ name: '.git', kind: 'file' }]);
    file(path.join(at('wt'), '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');

    const result = await scan({ rootPath: ROOT });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ name: 'wt', isGitRepo: true, branch: null });
  });

  test('finds a non-git project by its stack marker and labels the stack', async () => {
    dir(ROOT, [{ name: 'tool', kind: 'dir' }]);
    dir(at('tool'), [{ name: 'go.mod', kind: 'file' }]);

    const result = await scan({ rootPath: ROOT });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      name: 'tool',
      isGitRepo: false,
      branch: null,
      stack: { type: 'go', label: 'Go' }
    });
  });

  test('reads package.json so a React app is not just labelled Node.js', async () => {
    dir(ROOT, [{ name: 'ui', kind: 'dir' }]);
    dir(at('ui'), [{ name: '.git', kind: 'dir' }, { name: 'package.json', kind: 'file' }]);
    dir(path.join(at('ui'), '.git'), []);
    file(path.join(at('ui'), 'package.json'), JSON.stringify({ dependencies: { react: '18.0.0' } }));

    const result = await scan({ rootPath: ROOT });

    expect(result.candidates[0].stack).toMatchObject({ type: 'react', label: 'React' });
  });

  test('falls back to the file marker when package.json is unparseable', async () => {
    dir(ROOT, [{ name: 'broken', kind: 'dir' }]);
    dir(at('broken'), [{ name: 'package.json', kind: 'file' }]);
    file(path.join(at('broken'), 'package.json'), '{ not json');

    const result = await scan({ rootPath: ROOT });

    expect(result.candidates[0].stack).toMatchObject({ type: 'node', label: 'Node.js' });
  });

  test('never reports the root itself, even when it looks like a project', async () => {
    // A stray package.json next to the clones must not swallow the whole scan.
    dir(ROOT, [{ name: 'package.json', kind: 'file' }, { name: 'alpha', kind: 'dir' }]);
    file(path.join(ROOT, 'package.json'), '{}');
    repo(['alpha']);

    const result = await scan({ rootPath: ROOT });

    expect(namesOf(result)).toEqual(['alpha']);
  });

  test('skips ignored directories and dotfolders', async () => {
    dir(ROOT, [
      { name: 'node_modules', kind: 'dir' },
      { name: '.cache', kind: 'dir' },
      { name: 'keep', kind: 'dir' }
    ]);
    dir(at('node_modules'), [{ name: 'dep', kind: 'dir' }]);
    repo(['node_modules', 'dep']);
    dir(at('.cache'), [{ name: 'stale', kind: 'dir' }]);
    repo(['.cache', 'stale']);
    repo(['keep']);

    const result = await scan({ rootPath: ROOT });

    expect(namesOf(result)).toEqual(['keep']);
  });

  test('does not follow symlinked directories', async () => {
    dir(ROOT, [{ name: 'link', kind: 'link' }, { name: 'real', kind: 'dir' }]);
    dir(at('link'), [{ name: 'ghost', kind: 'dir' }]);
    repo(['link', 'ghost']);
    repo(['real']);

    const result = await scan({ rootPath: ROOT });

    expect(namesOf(result)).toEqual(['real']);
  });

  test('survives an unreadable subdirectory', async () => {
    dir(ROOT, [{ name: 'locked', kind: 'dir' }, { name: 'open', kind: 'dir' }]);
    dir(at('locked'), []);
    mockUnreadable.add(at('locked'));
    repo(['open']);

    const result = await scan({ rootPath: ROOT });

    expect(result.success).toBe(true);
    expect(namesOf(result)).toEqual(['open']);
  });

  test('respects the depth limit', async () => {
    dir(ROOT, [{ name: 'a', kind: 'dir' }]);
    dir(at('a'), [{ name: 'b', kind: 'dir' }]);
    dir(at('a', 'b'), [{ name: 'c', kind: 'dir' }]);
    dir(at('a', 'b', 'c'), [{ name: 'deep', kind: 'dir' }]);
    repo(['a', 'b', 'c', 'deep']); // depth 4 — past the default of 3

    expect((await scan({ rootPath: ROOT })).candidates).toHaveLength(0);
    expect((await scan({ rootPath: ROOT, maxDepth: 4 })).candidates).toHaveLength(1);
  });

  test('flags truncation instead of silently cutting the list', async () => {
    const many = [];
    for (let i = 0; i < 501; i++) {
      many.push({ name: `r${i}`, kind: 'dir' });
    }
    dir(ROOT, many);
    many.forEach(entry => repo([entry.name]));

    const result = await scan({ rootPath: ROOT });

    expect(result.truncated).toBe(true);
    expect(result.candidates).toHaveLength(500);
  });
});
