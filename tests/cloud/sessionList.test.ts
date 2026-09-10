/** @jest-environment node */
/**
 * What /api/sessions reports after the process that held the sessions is gone.
 *
 * The live sessions live in a Map in RAM, so a container restart empties it. The
 * metadata and the transcript survive on disk — sdkSessionId is persisted for
 * exactly this reason — but the list was derived from the Map alone, so the
 * server answered "no sessions" while still holding everything needed to offer
 * them back. The PWA then pruned them from view, which is what the user sees as
 * sessions being deleted by an update.
 */

jest.mock('uuid', () => ({ v4: () => 'unused-in-these-tests' }));

const { mergeSessionList, demoteOrphanedSessions, retireResumedSessions } = require('../../cloud/src/cloud/SessionManager');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const live = (id: string, over: Record<string, unknown> = {}) => ({
  id, projectName: 'agrak-http', status: 'running', ...over,
});

const persisted = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  sdkSessionId: `sdk-${id}`,
  projectName: 'agrak-http',
  status: 'running',
  model: 'claude-sonnet-4-6',
  createdAt: NOW - 60_000,
  lastActivity: NOW - 60_000,
  ...over,
});

test('a live session keeps its status and takes its metadata from disk', () => {
  const out = mergeSessionList([live('a', { status: 'idle' })], [persisted('a')], NOW, DAY);

  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({
    id: 'a',
    status: 'idle',
    model: 'claude-sonnet-4-6',
    createdAt: NOW - 60_000,
  });
});

test('a session whose process is gone comes back as resumable, with its sdk id', () => {
  const out = mergeSessionList([], [persisted('a')], NOW, DAY);

  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ id: 'a', status: 'resumable', sdkSessionId: 'sdk-a' });
});

test('a persisted session still marked running is reported resumable, not running', () => {
  // persistSessionMeta leaves `running` behind when the process dies with the
  // container. Repeating that claim offers a chat that can never answer.
  const out = mergeSessionList([], [persisted('a', { status: 'running' })], NOW, DAY);

  expect(out[0].status).toBe('resumable');
});

test('an orphan older than the timeout is dropped instead of piling up', () => {
  const old = persisted('stale', { lastActivity: NOW - 2 * DAY });

  expect(mergeSessionList([], [old], NOW, DAY)).toEqual([]);
});

test('a persisted session with no sdk id is not offered', () => {
  // Without the sdk id there is no transcript key to resume from, so listing it
  // would repeat the original sin: showing a session that cannot be opened.
  const out = mergeSessionList([], [persisted('a', { sdkSessionId: undefined })], NOW, DAY);

  expect(out).toEqual([]);
});

test('live and resumable sessions are reported together', () => {
  const out = mergeSessionList([live('a')], [persisted('a'), persisted('b')], NOW, DAY);

  expect(out.map((s: any) => [s.id, s.status]).sort())
    .toEqual([['a', 'running'], ['b', 'resumable']]);
});

test('a live session with no persisted metadata is still reported', () => {
  const out = mergeSessionList([live('ghost')], [], NOW, DAY);

  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ id: 'ghost', status: 'running', createdAt: null, model: null });
});

/**
 * The admin TUI counts user.sessions[] entries whose status is 'running' to show
 * how many sessions are active. Nothing clears that status when the process dies
 * with the container, so after a restart those counts claimed running sessions
 * that no longer existed.
 */
describe('demoteOrphanedSessions', () => {
  test('a session left marked running is no longer counted as running', () => {
    const { sessions, changed } = demoteOrphanedSessions([persisted('a', { status: 'running' })]);

    expect(changed).toBe(true);
    expect(sessions[0].status).toBe('resumable');
  });

  test('reports no change when there is nothing to demote', () => {
    const { sessions, changed } = demoteOrphanedSessions([persisted('a', { status: 'idle' })]);

    expect(changed).toBe(false);
    expect(sessions[0].status).toBe('idle');
  });

  test('leaves an errored session alone — that status is still true', () => {
    const { sessions } = demoteOrphanedSessions([persisted('a', { status: 'error' })]);

    expect(sessions[0].status).toBe('error');
  });
});

/**
 * Resuming a session mints a new id for the continued conversation. The entry it
 * was resumed from has to go: leaving it behind listed the same conversation
 * twice — once as the resumable original, once as the session now carrying it.
 */
describe('retireResumedSessions', () => {
  test('drops the entry the new session was resumed from', () => {
    const { sessions, changed } = retireResumedSessions(
      [persisted('old'), persisted('other', { sdkSessionId: 'sdk-other' })],
      'sdk-old',
    );

    expect(changed).toBe(true);
    expect(sessions.map((s: any) => s.id)).toEqual(['other']);
  });

  test('leaves everything alone when resuming from an id it does not hold', () => {
    // Resuming from the history list passes an SDK id that names no entry here.
    const { sessions, changed } = retireResumedSessions([persisted('a')], 'sdk-unknown');

    expect(changed).toBe(false);
    expect(sessions).toHaveLength(1);
  });

  test('is a no-op for a session that is not a resume', () => {
    const { sessions, changed } = retireResumedSessions([persisted('a')], undefined);

    expect(changed).toBe(false);
    expect(sessions).toHaveLength(1);
  });
});
