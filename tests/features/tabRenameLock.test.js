/**
 * Tab naming: the "AI tab naming" setting turns off every content-based
 * automatic rename.
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
  });
});
