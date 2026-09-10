/** @jest-environment jsdom */
/**
 * Collapsing a run of tool calls into one row.
 *
 * A turn that runs six shell commands printed six cards, pushing the assistant's
 * actual answer off the screen on a phone. The desktop chat already folds a run
 * of the same tool into a single row with a ×N badge; this brings the same shape
 * to the PWA, which re-renders its whole message list rather than mutating the
 * DOM as the desktop does.
 */

const { _groupToolRuns, renderChatMessages, _setupChatDelegation, state } = require('../../remote-ui/app.js');

global.t = (key) => key;

const tool = (name, over = {}) => ({
  role: 'tool', toolName: name, toolId: `${name}-${over.n ?? 1}`, status: 'done', ...over,
});
const text = (content) => ({ role: 'assistant', content });

test('a message that is not a tool passes straight through', () => {
  const out = _groupToolRuns([text('hola')]);

  expect(out).toHaveLength(1);
  expect(out[0].kind).toBe('single');
  expect(out[0].message.content).toBe('hola');
});

test('a lone tool call stays a lone card', () => {
  const out = _groupToolRuns([tool('Bash')]);

  expect(out).toHaveLength(1);
  expect(out[0].kind).toBe('single');
});

test('two calls to the same tool in a row become one group', () => {
  const out = _groupToolRuns([tool('Bash', { n: 1 }), tool('Bash', { n: 2 })]);

  expect(out).toHaveLength(1);
  expect(out[0].kind).toBe('group');
  expect(out[0].toolName).toBe('Bash');
  expect(out[0].cards).toHaveLength(2);
});

test('the group is keyed by its first card, which survives a re-render', () => {
  const out = _groupToolRuns([tool('Bash', { n: 1 }), tool('Bash', { n: 2 })]);

  expect(out[0].key).toBe('Bash-1');
});

test('a different tool breaks the run', () => {
  const out = _groupToolRuns([
    tool('Bash', { n: 1 }), tool('Bash', { n: 2 }), tool('Read', { n: 3 }),
  ]);

  expect(out).toHaveLength(2);
  expect(out[0].kind).toBe('group');
  expect(out[1].kind).toBe('single');
});

test('a message in the middle breaks the run', () => {
  const out = _groupToolRuns([tool('Bash', { n: 1 }), text('a ver'), tool('Bash', { n: 2 })]);

  expect(out.map(o => o.kind)).toEqual(['single', 'single', 'single']);
});

test('a group still working reports running', () => {
  const out = _groupToolRuns([
    tool('Bash', { n: 1 }), tool('Bash', { n: 2, status: 'running' }),
  ]);

  expect(out[0].status).toBe('running');
});

test('a group with a failure reports error once nothing is still running', () => {
  const out = _groupToolRuns([
    tool('Bash', { n: 1 }), tool('Bash', { n: 2, status: 'error' }),
  ]);

  expect(out[0].status).toBe('error');
});

test('running wins over error while a call is still in flight', () => {
  // Reporting the failure first would show a red group that is still working.
  const out = _groupToolRuns([
    tool('Bash', { n: 1, status: 'error' }), tool('Bash', { n: 2, status: 'running' }),
  ]);

  expect(out[0].status).toBe('running');
});

test('a group where everything finished reports done', () => {
  const out = _groupToolRuns([tool('Bash', { n: 1 }), tool('Bash', { n: 2 })]);

  expect(out[0].status).toBe('done');
});

/**
 * The list is rebuilt on every streamed event, so an open group has to stay open
 * across renders — otherwise it slams shut while its own commands are arriving.
 */
describe('rendering', () => {
  const render = (messages) => {
    state.sessions = { 'headless-a': { sessionId: 'headless-a', messages, tabName: 'p' } };
    state.selectedSessionId = 'headless-a';
    renderChatMessages();
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="chat-messages"></div>';
    state.projects = [];
    _setupChatDelegation();
  });

  test('a run renders as one row carrying the count', () => {
    render([tool('Bash', { n: 1 }), tool('Bash', { n: 2 }), tool('Bash', { n: 3 })]);

    const groups = document.querySelectorAll('.tool-group');
    expect(groups).toHaveLength(1);
    expect(groups[0].querySelector('.tool-group-badge').textContent).toBe('×3');
    expect(groups[0].classList.contains('open')).toBe(false);
  });

  test('tapping the row opens it', () => {
    render([tool('Bash', { n: 1 }), tool('Bash', { n: 2 })]);

    document.querySelector('.tool-group-header').click();

    expect(document.querySelector('.tool-group').classList.contains('open')).toBe(true);
  });

  test('an opened group is still open after the list re-renders', () => {
    // Distinct ids from the other tests: the open-group set is module state that
    // outlives a single test, so a shared key would toggle rather than open.
    const messages = [tool('Bash', { n: 10 }), tool('Bash', { n: 11 })];
    render(messages);
    document.querySelector('.tool-group-header').click();

    messages.push(tool('Bash', { n: 12 }));
    render(messages);

    expect(document.querySelector('.tool-group').classList.contains('open')).toBe(true);
    expect(document.querySelector('.tool-group-badge').textContent).toBe('×3');
  });

  test('a lone tool call renders as a plain card, not a group', () => {
    render([tool('Bash', { n: 1 })]);

    expect(document.querySelectorAll('.tool-group')).toHaveLength(0);
    expect(document.querySelectorAll('.tool-card')).toHaveLength(1);
  });
});
