/** @jest-environment node */
/**
 * Listing the conversations a project already has on disk.
 *
 * The only id a .jsonl carries is the SDK's own, but a session that is still
 * known to the server also has a cloud id — and that is the one every other
 * endpoint answers to. Reporting both lets the PWA tell a history entry and a
 * live session apart instead of listing the same chat twice.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-past-'));

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

const KNOWN_SDK_ID = '11111111-1111-1111-1111-111111111111';
const ORPHAN_SDK_ID = '22222222-2222-2222-2222-222222222222';

function writeTranscript(sdkId: string, prompt: string) {
  const dir = path.join(userHome, '.claude', 'projects', '-srv-agrak-http');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'user', sessionId: sdkId, message: { content: [{ type: 'text', text: prompt }] } }),
    JSON.stringify({ type: 'assistant', sessionId: sdkId, message: { content: [{ type: 'text', text: 'x'.repeat(300) }] } }),
  ];
  fs.writeFileSync(path.join(dir, `${sdkId}.jsonl`), lines.join('\n') + '\n');
}

beforeAll(() => {
  writeTranscript(KNOWN_SDK_ID, 'como levanto el server?');
  writeTranscript(ORPHAN_SDK_ID, 'que hace este repo?');
});

afterAll(() => {
  fs.rmSync(userHome, { recursive: true, force: true });
});

beforeEach(() => {
  store.getUser.mockResolvedValue({
    name: 'erpox',
    projects: [],
    sessions: [{ id: 'cloud-uuid-1', sdkSessionId: KNOWN_SDK_ID, projectName: 'agrak-http' }],
  });
});

test('reports the cloud id of a past session the server still knows', async () => {
  const sessions = await sessionManager.listPastSessions('erpox', 'agrak-http');
  const known = sessions.find((s: any) => s.sessionId === KNOWN_SDK_ID);

  expect(known).toBeDefined();
  expect(known.cloudSessionId).toBe('cloud-uuid-1');
});

test('leaves the cloud id off a transcript no session claims', async () => {
  const sessions = await sessionManager.listPastSessions('erpox', 'agrak-http');
  const orphan = sessions.find((s: any) => s.sessionId === ORPHAN_SDK_ID);

  expect(orphan).toBeDefined();
  expect(orphan.cloudSessionId).toBeUndefined();
});
