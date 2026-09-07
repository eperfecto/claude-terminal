/** @jest-environment node */
/**
 * Reading back the conversation of a session the server no longer holds in RAM.
 *
 * Three different ids name the same conversation: the uuid createSession() hands
 * to the API, the id the SDK stamps on its transcript, and the `headless-` key
 * the PWA uses locally. listPastSessions() can only report the SDK id — it reads
 * it out of the .jsonl — so a transcript asked for by that id has to resolve too,
 * or every chat opened from the history list comes back empty.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-transcript-'));

// The root and cloud/ trees carry different major versions of uuid, and the
// root one is ESM-only. SessionManager needs it solely to mint ids for new
// sessions, which nothing here exercises — so stub it and stay hermetic.
jest.mock('uuid', () => ({ v4: () => 'unused-in-these-tests' }));

jest.mock('../../cloud/src/store/store', () => ({
  store: {
    getUser: jest.fn(),
    getUserSync: jest.fn(() => null),
    saveUser: jest.fn(),
    userHomePath: jest.fn(() => userHome),
    getProjectPath: jest.fn((_user: string, project: string) => `/srv/${project}`),
  },
}));

const { store } = require('../../cloud/src/store/store');
const { sessionManager } = require('../../cloud/src/cloud/SessionManager');

const SDK_ID = '11111111-2222-3333-4444-555555555555';

/** Mirrors the directory name Claude Code derives from a project path. */
function transcriptDir(projectPath: string): string {
  return path.join(userHome, '.claude', 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'));
}

function writeTranscript(projectPath: string, sdkId: string, turns: Array<[string, string]>) {
  const dir = transcriptDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  const lines = turns.map(([type, text]) => JSON.stringify({
    type,
    sessionId: sdkId,
    message: { content: [{ type: 'text', text }] },
  }));
  fs.writeFileSync(path.join(dir, `${sdkId}.jsonl`), lines.join('\n') + '\n');
}

beforeAll(() => {
  // A decoy project, so finding the right transcript cannot be luck.
  writeTranscript('/srv/other-app', 'aaaaaaaa-0000-0000-0000-000000000000', [['user', 'unrelated']]);
  writeTranscript('/srv/agrak-http', SDK_ID, [
    ['user', 'como levanto el server?'],
    ['assistant', 'npm start'],
  ]);
});

afterAll(() => {
  fs.rmSync(userHome, { recursive: true, force: true });
});

beforeEach(() => {
  store.getUser.mockResolvedValue({ name: 'erpox', projects: [], sessions: [] });
});

test('resolves a transcript asked for by its SDK id', async () => {
  const messages = await sessionManager.getTranscript('erpox', SDK_ID);

  expect(messages).toEqual([
    { role: 'user', content: 'como levanto el server?' },
    { role: 'assistant', content: 'npm start' },
  ]);
});

test('still resolves a transcript asked for by its cloud session id', async () => {
  store.getUser.mockResolvedValue({
    name: 'erpox',
    projects: [],
    sessions: [{ id: 'cloud-uuid-1', sdkSessionId: SDK_ID, projectName: 'agrak-http' }],
  });

  const messages = await sessionManager.getTranscript('erpox', 'cloud-uuid-1');

  expect(messages).toEqual([
    { role: 'user', content: 'como levanto el server?' },
    { role: 'assistant', content: 'npm start' },
  ]);
});

test('returns nothing for an id that names no conversation', async () => {
  const messages = await sessionManager.getTranscript('erpox', 'does-not-exist');

  expect(messages).toEqual([]);
});
