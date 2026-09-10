/**
 * MCP servers for a cloud session.
 *
 * The Agent SDK does not discover MCP configuration on disk — it arrives only
 * through the `mcpServers` option — so the server reads it here. The file is the
 * same `.claude.json` Claude Code itself uses, so whatever you configure inside
 * the container is what a session runs: one place, one format, no second config
 * language invented for the cloud.
 *
 * Nothing here throws. A malformed config should cost you the MCP servers, not
 * the ability to open a session: the person who would have to fix the file is
 * looking at a phone.
 */

import fs from 'fs';
import path from 'path';

export type McpServerMap = Record<string, Record<string, unknown>>;

/** An entry the SDK can actually launch: a command to spawn, or a URL to call. */
function isUsable(entry: unknown): entry is Record<string, unknown> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  return typeof e.command === 'string' || typeof e.url === 'string';
}

export function loadMcpServers(userHome: string): McpServerMap {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(userHome, '.claude.json'), 'utf-8');
  } catch {
    return {}; // no config is the normal case, not a failure
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    console.warn(`[MCP] Ignoring unreadable .claude.json in ${userHome}: ${err.message}`);
    return {};
  }

  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return {};

  const out: McpServerMap = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (isUsable(entry)) out[name] = entry;
    else console.warn(`[MCP] Skipping "${name}": no command or url`);
  }
  return out;
}
