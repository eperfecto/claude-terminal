/**
 * `/rename <name>` (alias `/name`) is Claude Code's own command to rename the
 * conversation. Claude Terminal reuses it to name the tab: a name locks the
 * tab against automatic renames, a bare `/rename` hands it back to them.
 */

const RENAME_COMMAND_RE = /^\/(?:rename|name)(?:\s+([\s\S]*))?$/;

/**
 * @param {string} text - A submitted prompt or typed terminal line
 * @returns {{ name: string } | null} The requested name ('' to unlock), or null
 */
function parseRenameCommand(text) {
  const match = RENAME_COMMAND_RE.exec(String(text || '').trim());
  if (!match) return null;
  return { name: (match[1] || '').trim() };
}

module.exports = { parseRenameCommand };
