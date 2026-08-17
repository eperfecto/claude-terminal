// External editor launch tests (dialog.ipc.js)
//
// Regression guard for the Windows launcher quoting: `code` on Windows resolves
// to a .cmd wrapper that lives under a path with spaces
// ("...\Microsoft VS Code\bin\code.cmd"). It has to go through cmd.exe, and
// cmd.exe with /s strips the first and last quote of the command line — so
// letting Node quote the arguments normally broke the path at its first space
// and the editor silently never opened.

// Always use win32 path semantics so the Windows branches behave the same way
// on the Linux/macOS CI runners.
jest.mock('path', () => jest.requireActual('path').win32);

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  dialog: {},
  shell: {},
  app: { getVersion: jest.fn(() => '0.0.0') },
  clipboard: {}
}));

jest.mock('../../src/main/services/UpdaterService', () => ({}));

jest.mock('../../src/main/utils/paths', () => ({
  settingsFile: 'C:\\mock\\settings.json'
}));

const mockSpawn = jest.fn();
const mockStatSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.mock('child_process', () => ({ spawn: (...args) => mockSpawn(...args) }));

jest.mock('fs', () => ({
  statSync: (...args) => mockStatSync(...args),
  readFileSync: (...args) => mockReadFileSync(...args),
  existsSync: jest.fn(() => false),
  watch: jest.fn()
}));

const { openInEditor, _buildEditorCommand } = require('../../src/main/ipc/dialog.ipc');

const BIN_DIR = 'C:\\Program Files\\Fake Editor\\bin';
const CMD_LAUNCHER = `${BIN_DIR}\\code.cmd`;
const EXE_LAUNCHER = `${BIN_DIR}\\code.exe`;
// PATHEXT is uppercase on real Windows, so a bare `code` resolves to `code.CMD`.
// The filesystem is case-insensitive, and both WINDOWS_SCRIPT_EXT and the .exe
// branch are case-insensitive too — this is what the resolver actually returns.
const CMD_RESOLVED = `${BIN_DIR}\\code.CMD`;
const EXE_RESOLVED = `${BIN_DIR}\\code.EXE`;
const TARGET = 'C:\\projects\\my-app';

const realPlatform = process.platform;
const realEnv = process.env;

function setPlatform(platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Make only the given absolute paths look like existing files (case-insensitive, like NTFS). */
function existingFiles(...paths) {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  mockStatSync.mockImplementation((candidate) => {
    if (set.has(String(candidate).toLowerCase())) return { isFile: () => true };
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...realEnv,
    PATH: 'C:\\Program Files\\Fake Editor\\bin',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    COMSPEC: 'C:\\Windows\\system32\\cmd.exe'
  };
  mockStatSync.mockImplementation(() => {
    throw new Error('ENOENT');
  });
  mockSpawn.mockReturnValue({ on: jest.fn(), unref: jest.fn() });
});

afterEach(() => {
  setPlatform(realPlatform);
  process.env = realEnv;
});

describe('_buildEditorCommand', () => {
  test('wraps a .cmd launcher for cmd.exe with verbatim arguments', () => {
    setPlatform('win32');
    existingFiles(CMD_LAUNCHER);

    const { file, args, options } = _buildEditorCommand('code', TARGET);

    expect(file).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    // The outer quote pair is what `/s` consumes; both inner tokens must survive.
    expect(args[3]).toBe(`""${CMD_RESOLVED}" "${TARGET}""`);
    expect(options.windowsVerbatimArguments).toBe(true);
  });

  test('spawns a resolved .exe directly, without cmd.exe', () => {
    setPlatform('win32');
    existingFiles(EXE_LAUNCHER);

    const { file, args, options } = _buildEditorCommand('code', TARGET);

    expect(file).toBe(EXE_RESOLVED);
    expect(args).toEqual([TARGET]);
    expect(options.windowsVerbatimArguments).toBeUndefined();
  });

  test('falls back to the raw binary when nothing resolves, so ENOENT surfaces', () => {
    setPlatform('win32');

    const { file, args, options } = _buildEditorCommand('nvim', TARGET);

    expect(file).toBe('nvim');
    expect(args).toEqual([TARGET]);
    expect(options.windowsVerbatimArguments).toBeUndefined();
  });

  test('passes the binary through untouched outside Windows', () => {
    setPlatform('darwin');

    expect(_buildEditorCommand('code', '/Users/me/app')).toEqual({
      file: 'code',
      args: ['/Users/me/app'],
      options: {}
    });
    expect(mockStatSync).not.toHaveBeenCalled();
  });
});

describe('openInEditor', () => {
  test('spawns the cmd.exe wrapper with the verbatim option merged in', () => {
    setPlatform('win32');
    existingFiles(CMD_LAUNCHER);

    expect(openInEditor({ editor: 'code', path: TARGET })).toEqual({ success: true });

    const [file, args, options] = mockSpawn.mock.calls[0];
    expect(file).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(args[3]).toBe(`""${CMD_RESOLVED}" "${TARGET}""`);
    expect(options).toMatchObject({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    });
  });

  test('accepts filePath as well as path', () => {
    setPlatform('darwin');

    expect(openInEditor({ editor: 'code', filePath: '/Users/me/app/main.js' })).toEqual({ success: true });
    expect(mockSpawn.mock.calls[0][1]).toEqual(['/Users/me/app/main.js']);
  });

  test('rejects dangerous characters in the editor binary', () => {
    setPlatform('darwin');

    const result = openInEditor({ editor: 'code & calc', path: '/Users/me/app' });

    expect(result.success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('rejects dangerous characters in the target path', () => {
    setPlatform('darwin');

    const result = openInEditor({ editor: 'code', path: '/Users/me/app; rm -rf /' });

    expect(result.success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('fails when no path is given', () => {
    setPlatform('darwin');

    expect(openInEditor({ editor: 'code' }).success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('falls back to the configured editor when none is passed', () => {
    setPlatform('darwin');
    mockReadFileSync.mockReturnValue(JSON.stringify({ editor: 'zed' }));

    expect(openInEditor({ path: '/Users/me/app' })).toEqual({ success: true });
    expect(mockSpawn.mock.calls[0][0]).toBe('zed');
  });

  test('fails when no editor is passed and none is configured', () => {
    setPlatform('darwin');
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(openInEditor({ path: '/Users/me/app' }).success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
