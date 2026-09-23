/**
 * A tab the user named keeps its lock across restarts: the saved session
 * carries `nameLocked` so the restore can hand it back to createTerminal().
 */

const { fs } = window.electron_nodeModules;
const { saveTerminalSessionsImmediate } = require('../../src/renderer/services/TerminalSessionService');
const { addTerminal, removeTerminal, setSetting } = require('../../src/renderer/state');

function savedTabs() {
  const [, json] = fs.promises.writeFile.mock.calls.at(-1);
  return JSON.parse(json).projects.p1.tabs;
}

describe('terminal session name lock', () => {
  beforeEach(() => {
    fs.promises.writeFile.mockReset().mockResolvedValue();
    fs.promises.rename.mockReset().mockResolvedValue();
    fs.promises.readFile.mockReset().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    setSetting('restoreTerminalSessions', true);
  });

  afterEach(() => {
    removeTerminal('t1');
  });

  test('saves the lock of a tab the user named', async () => {
    addTerminal('t1', { name: 'Mine', nameLocked: true, project: { id: 'p1', path: '/p1' } });
    await saveTerminalSessionsImmediate();
    expect(savedTabs()[0]).toMatchObject({ name: 'Mine', nameLocked: true });
  });

  test('leaves the lock out for an automatically named tab', async () => {
    addTerminal('t1', { name: 'Fix Login Bug', project: { id: 'p1', path: '/p1' } });
    await saveTerminalSessionsImmediate();
    expect(savedTabs()[0]).not.toHaveProperty('nameLocked');
  });
});
