/** @jest-environment jsdom */
/**
 * Choosing which cloud session to put in front of the user.
 *
 * The server only lists sessions it still holds, so every entry is resumable;
 * the most recently active one is the one the user was last looking at.
 */

const { _pickResumableSession } = require('../../remote-ui/app.js');

const session = (id, over = {}) => ({
  id, projectName: 'agrak-http', status: 'running',
  createdAt: 1000, lastActivity: 1000, ...over,
});

test('returns nothing when the server lists none', () => {
  expect(_pickResumableSession([])).toBeNull();
  expect(_pickResumableSession(undefined)).toBeNull();
});

test('returns the only live session', () => {
  expect(_pickResumableSession([session('a')]).id).toBe('a');
});

test('prefers the most recently active when several are live', () => {
  const picked = _pickResumableSession([
    session('old', { lastActivity: 500 }),
    session('newest', { lastActivity: 9000 }),
    session('mid', { lastActivity: 3000 }),
  ]);
  expect(picked.id).toBe('newest');
});

test('falls back to createdAt when a session never reported activity', () => {
  const picked = _pickResumableSession([
    session('a', { lastActivity: null, createdAt: 100 }),
    session('b', { lastActivity: null, createdAt: 700 }),
  ]);
  expect(picked.id).toBe('b');
});
