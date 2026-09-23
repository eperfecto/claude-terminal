/**
 * Tab naming: a name the user typed wins over every automatic source, and the
 * "AI tab naming" setting turns off every content-based automatic rename.
 */

jest.mock('@xterm/xterm', () => ({ Terminal: jest.fn() }));
jest.mock('@xterm/addon-fit', () => ({ FitAddon: jest.fn() }));
jest.mock('@xterm/addon-webgl', () => ({ WebglAddon: jest.fn() }));
jest.mock('marked', () => ({ Marked: jest.fn(() => ({ parse: (s) => s, use: jest.fn() })) }));
jest.mock('../../src/renderer/ui/components/ChatView', () => ({ createChatView: jest.fn() }));
jest.mock('../../src/renderer/services/TerminalSessionService', () => ({ saveTerminalSessions: jest.fn() }));

const { TerminalManager } = require('../../src/renderer/ui/components/TerminalManager');
const { addTerminal, getTerminal, removeTerminal, setSetting } = require('../../src/renderer/state');

const ID = 'term-1';

function mountTab(id, name) {
  document.body.innerHTML = `<div class="terminal-tab" data-id="${id}"><span class="tab-name">${name}</span></div>`;
}

function renameViaInput(manager, id, value, key = 'Enter') {
  manager._startRenameTab(id);
  const input = document.querySelector('.tab-name-input');
  input.value = value;
  input.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('tab naming', () => {
  let manager;

  beforeEach(() => {
    manager = new TerminalManager();
    manager._setSessionCustomName = jest.fn();
    addTerminal(ID, { name: 'my-project', project: { id: 'p1' }, inputBuffer: '' });
    mountTab(ID, 'my-project');
    setSetting('aiTabNaming', true);
  });

  afterEach(() => {
    removeTerminal(ID);
  });

  test('an automatic rename updates an unlocked tab', async () => {
    await manager.updateTerminalTabName(ID, 'Fix Login Bug');
    expect(getTerminal(ID).name).toBe('Fix Login Bug');
    expect(document.querySelector('.tab-name').textContent).toBe('Fix Login Bug');
  });

  test('a manual rename locks the tab against automatic renames', async () => {
    await manager.updateTerminalTabName(ID, 'Mine', { manual: true });
    await manager.updateTerminalTabName(ID, 'Fix Login Bug');
    expect(getTerminal(ID).name).toBe('Mine');
    expect(getTerminal(ID).nameLocked).toBe(true);
    expect(document.querySelector('.tab-name').textContent).toBe('Mine');
  });

  test('a manual rename can still change a locked tab', async () => {
    await manager.updateTerminalTabName(ID, 'Mine', { manual: true });
    await manager.updateTerminalTabName(ID, 'Mine v2', { manual: true });
    expect(getTerminal(ID).name).toBe('Mine v2');
  });

  test('renaming from the tab input locks the tab', async () => {
    renameViaInput(manager, ID, 'Release prep');
    await Promise.resolve();
    expect(getTerminal(ID).name).toBe('Release prep');
    expect(getTerminal(ID).nameLocked).toBe(true);
    expect(document.querySelector('.tab-name').textContent).toBe('Release prep');
  });

  test('cancelling the tab input with Escape does not lock the tab', () => {
    renameViaInput(manager, ID, 'Discarded', 'Escape');
    expect(getTerminal(ID).name).toBe('my-project');
    expect(getTerminal(ID).nameLocked).toBeFalsy();
  });

  test('confirming the unchanged name from the tab input locks it', () => {
    renameViaInput(manager, ID, 'my-project');
    expect(getTerminal(ID).name).toBe('my-project');
    expect(getTerminal(ID).nameLocked).toBe(true);
  });

  test('clearing the tab input hands the tab back to automatic naming', async () => {
    await manager.updateTerminalTabName(ID, 'Mine', { manual: true });
    renameViaInput(manager, ID, '   ');
    expect(getTerminal(ID).nameLocked).toBe(false);
    expect(document.querySelector('.tab-name').textContent).toBe('Mine');
    await manager.updateTerminalTabName(ID, 'Fix Login Bug');
    expect(getTerminal(ID).name).toBe('Fix Login Bug');
  });

  test('cancelling shows a name that changed while the input was open', async () => {
    manager._startRenameTab(ID);
    await manager.updateTerminalTabName(ID, 'Claude Title');
    const input = document.querySelector('.tab-name-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.tab-name').textContent).toBe('Claude Title');
  });

  describe('naming from typed terminal input', () => {
    test('renames the tab when AI tab naming is on', () => {
      manager._autoNameTabFromInput(ID, 'fix the login redirect bug');
      expect(getTerminal(ID).name).toBe('Fix Login Redirect Bug');
    });

    test('leaves the tab alone when AI tab naming is off', () => {
      setSetting('aiTabNaming', false);
      manager._autoNameTabFromInput(ID, 'fix the login redirect bug');
      expect(getTerminal(ID).name).toBe('my-project');
    });

    test('leaves a locked tab alone', async () => {
      await manager.updateTerminalTabName(ID, 'Mine', { manual: true });
      manager._autoNameTabFromInput(ID, 'fix the login redirect bug');
      expect(getTerminal(ID).name).toBe('Mine');
    });
  });
});
