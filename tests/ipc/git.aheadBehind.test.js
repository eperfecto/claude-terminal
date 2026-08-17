// git-ahead-behind IPC handler — the pull/push button counts.
//
// The crux is the fetch flag: `getAheadBehind` takes skipFetch, which is the
// inverse of what the caller asks for, and getting it backwards would either
// make every project selection hit the network or leave the pull count frozen.

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn(), on: jest.fn() }
}));

const mockGetAheadBehind = jest.fn();
const mockGetCurrentBranch = jest.fn();

// The git utils module is large and spawns processes; only these two matter here.
jest.mock('../../src/main/utils/git', () => new Proxy({
  getAheadBehind: (...args) => mockGetAheadBehind(...args),
  getCurrentBranch: (...args) => mockGetCurrentBranch(...args)
}, {
  // Every other named import git.ipc.js destructures resolves to a no-op stub.
  get: (target, prop) => (prop in target ? target[prop] : jest.fn())
}));

jest.mock('../../src/main/utils/commitMessageGenerator', () => ({
  generateCommitMessage: jest.fn(),
  generateMultiCommitMessages: jest.fn(),
  generateSessionRecap: jest.fn(),
  groupFiles: jest.fn()
}));
jest.mock('../../src/main/utils/prDescriptionGenerator', () => ({ generatePrDescription: jest.fn() }));
jest.mock('../../src/main/services/GitHubAuthService', () => ({}));
jest.mock('../../src/main/services/TelemetryService', () => ({ sendFeaturePing: jest.fn() }));

const { ipcMain } = require('electron');
const { registerGitHandlers } = require('../../src/main/ipc/git.ipc');

const handlers = {};
beforeAll(() => {
  ipcMain.handle.mockImplementation((channel, handler) => { handlers[channel] = handler; });
  registerGitHandlers();
});

const invoke = (params) => handlers['git-ahead-behind'](null, params);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAheadBehind.mockResolvedValue({ ahead: 1, behind: 2, hasRemote: true, remote: 'origin/main' });
  mockGetCurrentBranch.mockResolvedValue('main');
});

describe('git-ahead-behind', () => {
  test('is registered', () => {
    expect(typeof handlers['git-ahead-behind']).toBe('function');
  });

  test('does not touch the network by default', async () => {
    await invoke({ projectPath: '/repo', branch: 'main' });

    // Third argument is skipFetch — true means offline.
    expect(mockGetAheadBehind).toHaveBeenCalledWith('/repo', 'main', true);
  });

  test('fetches only when the caller opts in', async () => {
    await invoke({ projectPath: '/repo', branch: 'main', fetch: true });

    expect(mockGetAheadBehind).toHaveBeenCalledWith('/repo', 'main', false);
  });

  test('resolves the branch when the caller omits it', async () => {
    mockGetCurrentBranch.mockResolvedValue('feature/x');

    await invoke({ projectPath: '/repo' });

    expect(mockGetCurrentBranch).toHaveBeenCalledWith('/repo');
    expect(mockGetAheadBehind).toHaveBeenCalledWith('/repo', 'feature/x', true);
  });

  test('does not resolve the branch when one is supplied', async () => {
    await invoke({ projectPath: '/repo', branch: 'main' });

    expect(mockGetCurrentBranch).not.toHaveBeenCalled();
  });

  test('returns the counts through untouched', async () => {
    const counts = { ahead: 3, behind: 0, hasRemote: true, remote: 'origin/main' };
    mockGetAheadBehind.mockResolvedValue(counts);

    expect(await invoke({ projectPath: '/repo', branch: 'main' })).toEqual(counts);
  });

  test('reports a detached or branchless checkout instead of guessing', async () => {
    mockGetCurrentBranch.mockResolvedValue(null);

    expect(await invoke({ projectPath: '/repo' })).toEqual({ error: true, message: 'No branch' });
    expect(mockGetAheadBehind).not.toHaveBeenCalled();
  });

  test('turns a thrown error into a result instead of rejecting', async () => {
    mockGetAheadBehind.mockRejectedValue(new Error('git exploded'));

    await expect(invoke({ projectPath: '/repo', branch: 'main' }))
      .resolves.toEqual({ error: true, message: 'git exploded' });
  });

  test('survives being called with no params at all', async () => {
    mockGetCurrentBranch.mockResolvedValue(null);
    await expect(invoke(undefined)).resolves.toEqual({ error: true, message: 'No branch' });
  });
});
