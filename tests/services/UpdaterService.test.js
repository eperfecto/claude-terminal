// UpdaterService unit tests — auto-update cycle
//
// Covers the three defects that broke the cycle on this fork:
//   1. the pending-download cache was resolved under userData/.. instead of the
//      OS cache dir, making clearStalePendingCache() a permanent no-op;
//   2. versions were compared as strings ('1.2.9' >= '1.2.17' is true);
//   3. a manual check reported the server version as an update even when it
//      equalled the installed one, and silently claimed "up to date" in dev.

const path = require('path');

// ─── Virtual filesystem ─────────────────────────────────────────────────────
const mockVirtualFs = new Map();
const mockDeleted = [];

jest.mock('fs', () => {
  const realFs = jest.requireActual('fs');
  return {
    ...realFs,
    existsSync: jest.fn((p) => mockVirtualFs.has(p)),
    readFileSync: jest.fn((p) => {
      if (!mockVirtualFs.has(p)) {
        const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return mockVirtualFs.get(p);
    }),
    readdirSync: jest.fn((dir) => {
      const sep = require('path').sep;
      const prefix = dir.endsWith(sep) ? dir : dir + sep;
      return [...mockVirtualFs.keys()]
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length));
    }),
    unlinkSync: jest.fn((p) => {
      mockDeleted.push(p);
      mockVirtualFs.delete(p);
    }),
  };
});

// ─── Electron / electron-updater mocks ──────────────────────────────────────
const mockApp = {
  isPackaged: true,
  getVersion: jest.fn(() => '1.2.17'),
  getName: jest.fn(() => 'claude-terminal'),
  getAppPath: jest.fn(() => '/mock/app'),
};

jest.mock('electron', () => ({
  app: mockApp,
  Notification: jest.fn(() => ({ on: jest.fn(), show: jest.fn() })),
}));

const mockAutoUpdater = {
  on: jest.fn(),
  checkForUpdates: jest.fn(),
  checkForUpdatesAndNotify: jest.fn(),
  quitAndInstall: jest.fn(),
};

jest.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }));

// ─── Helpers ────────────────────────────────────────────────────────────────
const RESOURCES_PATH = '/mock/resources';
const CACHE_ROOT = 'C:\\Users\\Test\\AppData\\Local';

function loadService() {
  let service;
  jest.isolateModules(() => {
    service = require('../../src/main/services/UpdaterService');
  });
  return service;
}

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

describe('UpdaterService', () => {
  let originalResourcesPath;
  let originalLocalAppData;
  let originalDevFlag;

  beforeEach(() => {
    mockVirtualFs.clear();
    mockDeleted.length = 0;
    jest.clearAllMocks();

    mockApp.isPackaged = true;
    mockApp.getVersion.mockReturnValue('1.2.17');

    originalResourcesPath = process.resourcesPath;
    originalLocalAppData = process.env.LOCALAPPDATA;
    originalDevFlag = process.env.CT_DEV_UPDATER;

    process.resourcesPath = RESOURCES_PATH;
    process.env.LOCALAPPDATA = CACHE_ROOT;
    delete process.env.CT_DEV_UPDATER;
  });

  afterEach(() => {
    process.resourcesPath = originalResourcesPath;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    if (originalDevFlag === undefined) delete process.env.CT_DEV_UPDATER;
    else process.env.CT_DEV_UPDATER = originalDevFlag;
  });

  describe('getPendingCacheDir', () => {
    it('resolves the OS cache dir on Windows, not userData', () => {
      mockVirtualFs.set(
        path.join(RESOURCES_PATH, 'app-update.yml'),
        'provider: github\nupdaterCacheDirName: claude-terminal-updater\n'
      );

      const dir = withPlatform('win32', () => loadService().getPendingCacheDir());

      expect(dir).toBe(path.join(CACHE_ROOT, 'claude-terminal-updater', 'pending'));
      expect(dir).not.toMatch(/Roaming/);
    });

    it('falls back to the app name when app-update.yml has no cache dir name', () => {
      const dir = withPlatform('win32', () => loadService().getPendingCacheDir());

      expect(dir).toBe(path.join(CACHE_ROOT, 'claude-terminal-updater', 'pending'));
    });

    it('uses ~/.cache on Linux', () => {
      process.env.XDG_CACHE_HOME = '/home/test/.cache';
      const dir = withPlatform('linux', () => loadService().getPendingCacheDir());
      delete process.env.XDG_CACHE_HOME;

      expect(dir).toBe(path.join('/home/test/.cache', 'claude-terminal-updater', 'pending'));
    });
  });

  describe('clearStalePendingCache', () => {
    function seedCache(cachedInstallerName) {
      const dir = path.join(CACHE_ROOT, 'claude-terminal-updater', 'pending');
      mockVirtualFs.set(
        path.join(dir, 'update-info.json'),
        JSON.stringify({ fileName: cachedInstallerName })
      );
      mockVirtualFs.set(path.join(dir, cachedInstallerName), 'binary');
      return dir;
    }

    it('clears a cached download the installed version already covers', () => {
      const dir = seedCache('Claude Terminal Setup 1.2.16.exe');

      withPlatform('win32', () => loadService().clearStalePendingCache());

      expect(mockDeleted).toContain(path.join(dir, 'update-info.json'));
      expect(mockDeleted).toContain(path.join(dir, 'Claude Terminal Setup 1.2.16.exe'));
    });

    it('keeps a cached download that is newer than the installed version', () => {
      // Regression: '1.2.9' >= '1.2.17' is true as a string compare, which used
      // to wipe a perfectly valid pending update.
      mockApp.getVersion.mockReturnValue('1.2.9');
      seedCache('Claude Terminal Setup 1.2.17.exe');

      withPlatform('win32', () => loadService().clearStalePendingCache());

      expect(mockDeleted).toEqual([]);
    });

    it('clears a stale download across a multi-digit minor bump', () => {
      // '1.10.0' >= '1.9.0' is false as a string compare.
      mockApp.getVersion.mockReturnValue('1.10.0');
      const dir = seedCache('Claude Terminal Setup 1.9.0.exe');

      withPlatform('win32', () => loadService().clearStalePendingCache());

      expect(mockDeleted).toContain(path.join(dir, 'update-info.json'));
    });

    it('does nothing when no download is pending', () => {
      expect(() => withPlatform('win32', () => loadService().clearStalePendingCache())).not.toThrow();
      expect(mockDeleted).toEqual([]);
    });
  });

  describe('manualCheck', () => {
    it('reports no update when the server version equals the installed one', async () => {
      mockAutoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.17' } });

      const result = await loadService().manualCheck();

      expect(result).toEqual({
        available: false,
        version: '1.2.17',
        currentVersion: '1.2.17',
        devMode: false,
      });
    });

    it('reports an update when the server version is newer', async () => {
      mockAutoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.18' } });

      const result = await loadService().manualCheck();

      expect(result.available).toBe(true);
      expect(result.version).toBe('1.2.18');
    });

    it('reports dev mode instead of a silent "up to date" in an unpackaged run', async () => {
      mockApp.isPackaged = false;

      const result = await loadService().manualCheck();

      expect(result).toEqual({
        available: false,
        version: null,
        currentVersion: '1.2.17',
        devMode: true,
      });
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('runs a real check in an unpackaged run when CT_DEV_UPDATER=1', async () => {
      mockApp.isPackaged = false;
      process.env.CT_DEV_UPDATER = '1';
      mockAutoUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.18' } });

      const result = await loadService().manualCheck();

      expect(result.devMode).toBe(false);
      expect(result.available).toBe(true);
      expect(mockAutoUpdater.forceDevUpdateConfig).toBe(true);
    });
  });

  describe('checkForUpdates', () => {
    it('stays inert in an unpackaged run', () => {
      mockApp.isPackaged = false;

      loadService().checkForUpdates(false);

      expect(mockAutoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    });

    it('starts the cycle in a packaged run', () => {
      const service = loadService();
      withPlatform('win32', () => service.checkForUpdates(true));

      expect(mockAutoUpdater.checkForUpdatesAndNotify).toHaveBeenCalled();
      expect(mockAutoUpdater.forceDevUpdateConfig).toBe(false);

      service.stopPeriodicCheck();
    });
  });
});
