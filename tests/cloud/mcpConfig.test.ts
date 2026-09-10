/** @jest-environment node */
/**
 * Where a cloud session gets its MCP servers.
 *
 * The SDK does not read `.claude.json` off disk — MCP reaches it only through the
 * `mcpServers` option — so the server has to load the file itself. It reads the
 * same file Claude Code uses, so the thing you configure inside the container is
 * the thing the session runs, rather than a second format invented here.
 *
 * A broken config must never cost you the session: you would discover it from a
 * phone, with no way to fix the file.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const { loadMcpServers } = require('../../cloud/src/cloud/mcpConfig');

let home: string;

const writeConfig = (contents: string) => {
  fs.writeFileSync(path.join(home, '.claude.json'), contents, 'utf-8');
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mcp-'));
});

test('loads the servers declared in .claude.json', () => {
  writeConfig(JSON.stringify({
    mcpServers: {
      engram: { command: 'engram', args: ['mcp', '--tools=agent'] },
      codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
    },
  }));

  const servers = loadMcpServers(home);

  expect(Object.keys(servers).sort()).toEqual(['codegraph', 'engram']);
  expect(servers.engram.args).toEqual(['mcp', '--tools=agent']);
});

test('returns nothing when the user has no config at all', () => {
  expect(loadMcpServers(home)).toEqual({});
});

test('returns nothing when the config declares no servers', () => {
  writeConfig(JSON.stringify({ theme: 'dark' }));

  expect(loadMcpServers(home)).toEqual({});
});

test('a corrupt config costs the MCP servers, not the session', () => {
  writeConfig('{ this is not json');

  expect(loadMcpServers(home)).toEqual({});
});

test('ignores a mcpServers that is not an object', () => {
  writeConfig(JSON.stringify({ mcpServers: ['engram'] }));

  expect(loadMcpServers(home)).toEqual({});
});

test('drops an entry with no command rather than handing the SDK a broken one', () => {
  writeConfig(JSON.stringify({
    mcpServers: {
      good: { command: 'engram' },
      broken: { args: ['mcp'] },
      alsoBroken: null,
    },
  }));

  expect(Object.keys(loadMcpServers(home))).toEqual(['good']);
});

test('keeps http and sse servers, which carry a url instead of a command', () => {
  writeConfig(JSON.stringify({
    mcpServers: {
      remote: { type: 'http', url: 'https://example.com/mcp' },
    },
  }));

  expect(Object.keys(loadMcpServers(home))).toEqual(['remote']);
});
