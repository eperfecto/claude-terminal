/**
 * Project IPC Handlers
 * Handles project scanning and statistics
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { projectsFile } = require('../utils/paths');
const { matchMarkers } = require('../../shared/project-markers');

// Pre-compiled regex patterns for TODO scanning (avoid re-allocation per line)
const TODO_REGEX_SLASH = /\/\/\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i;
const TODO_REGEX_HASH  = /#\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i;
const TODO_REGEX_LUA   = /--\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i;

// Bulk-import scan limits. Depth 3 covers both ~/dev/repo and ~/dev/org/repo
// without walking an entire home directory.
const SCAN_MAX_DEPTH = 3;
const SCAN_MAX_RESULTS = 500;
const SCAN_IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', '__pycache__', 'vendor',
  'target', 'venv', 'env', 'coverage', 'out', 'bin', 'obj'
]);

/**
 * Register project IPC handlers
 */
function registerProjectHandlers() {
  // Scan TODO/FIXME in project
  ipcMain.handle('scan-todos', async (event, projectPath) => {
    // Validate projectPath to prevent path traversal
    if (!projectPath || typeof projectPath !== 'string') return [];
    const resolvedPath = path.resolve(projectPath);
    try {
      const stat = await fs.promises.stat(resolvedPath);
      if (!stat.isDirectory()) return [];
    } catch (e) {
      return [];
    }

    const todos = [];
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.lua', '.go', '.rs', '.java', '.cpp', '.c', '.h'];
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor'];

    async function scanDir(dir, depth = 0) {
      if (depth > 5 || todos.length >= 50) return;
      try {
        const items = await fs.promises.readdir(dir);
        for (const item of items) {
          if (todos.length >= 50) return;
          if (ignoreDirs.includes(item)) continue;
          const fullPath = path.join(dir, item);
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.isDirectory()) {
              await scanDir(fullPath, depth + 1);
            } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
              await scanFile(fullPath, projectPath);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    async function scanFile(filePath, basePath) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        const relativePath = path.relative(basePath, filePath);

        lines.forEach((line, i) => {
          const todoMatch = TODO_REGEX_SLASH.exec(line) ||
                            TODO_REGEX_HASH.exec(line) ||
                            TODO_REGEX_LUA.exec(line);
          if (todoMatch && todos.length < 50) {
            todos.push({
              type: todoMatch[1].toUpperCase(),
              text: todoMatch[2].trim() || '(no description)',
              file: relativePath,
              line: i + 1
            });
          }
        });
      } catch (e) {}
    }

    await scanDir(resolvedPath);
    return todos;
  });

  // Scan a directory tree for importable projects (bulk import)
  ipcMain.handle('scan-project-folders', async (event, params) => {
    const { rootPath, maxDepth = SCAN_MAX_DEPTH } = params || {};

    if (!rootPath || typeof rootPath !== 'string') {
      return { success: false, error: 'Invalid root path' };
    }
    const resolvedRoot = path.resolve(rootPath);
    try {
      const stat = await fs.promises.stat(resolvedRoot);
      if (!stat.isDirectory()) return { success: false, error: 'Not a directory' };
    } catch (e) {
      return { success: false, error: 'Path is not readable' };
    }

    const candidates = [];
    let truncated = false;

    async function walk(dir, depth) {
      if (depth > maxDepth || truncated) return;

      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (e) {
        return; // unreadable directory (permissions, race) — skip, never abort the scan
      }

      const names = entries.map(e => e.name);
      // The root is the container the user picked, never a result itself:
      // otherwise a stray package.json beside the clones would swallow the
      // whole scan and report a single "project".
      if (depth > 0) {
        const candidate = await describeCandidate(dir, names);
        if (candidate) {
          if (candidates.length >= SCAN_MAX_RESULTS) {
            truncated = true;
            return;
          }
          candidates.push(candidate);
          // A project's own subdirectories are its source tree, not more projects.
          return;
        }
      }

      for (const entry of entries) {
        if (truncated) return;
        // isDirectory() is false for symlinks here (withFileTypes does not follow
        // them), so link loops cannot make the walk run away.
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (SCAN_IGNORED_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name), depth + 1);
      }
    }

    await walk(resolvedRoot, 0);
    return { success: true, candidates, truncated };
  });
}

/**
 * Decide whether a directory is an importable project and describe it.
 * @param {string} dir
 * @param {string[]} names Directory listing already read by the caller
 * @returns {Promise<{path: string, name: string, isGitRepo: boolean, branch: string|null, stack: object|null}|null>}
 */
async function describeCandidate(dir, names) {
  // `.git` is a directory in a normal clone and a FILE in a worktree — both count.
  const isGitRepo = names.includes('.git');
  const stack = await detectStack(dir, names);
  if (!isGitRepo && !stack) return null;

  return {
    path: dir,
    name: path.basename(dir),
    isGitRepo,
    branch: isGitRepo ? await readGitBranch(dir) : null,
    stack
  };
}

/**
 * Identify the stack from the directory listing, reading package.json only when
 * it exists. Scanning hundreds of folders must not spawn a process per folder,
 * so this never shells out to git or a package manager.
 */
async function detectStack(dir, names) {
  let deps = new Set();
  if (names.includes('package.json')) {
    try {
      const pkg = JSON.parse(await fs.promises.readFile(path.join(dir, 'package.json'), 'utf8'));
      deps = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {})
      ]);
    } catch (e) {
      // Unparseable package.json still marks the folder as a Node project via
      // the file marker, so fall through with no dependency information.
    }
  }
  return matchMarkers(names, deps);
}

/**
 * Current branch straight out of .git/HEAD — no git process.
 * Returns null for a detached HEAD or a worktree (.git is a file there).
 */
async function readGitBranch(dir) {
  try {
    const head = await fs.promises.readFile(path.join(dir, '.git', 'HEAD'), 'utf8');
    const match = /^ref:\s*refs\/heads\/(.+)$/m.exec(head.trim());
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

module.exports = { registerProjectHandlers };
