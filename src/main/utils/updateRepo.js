/**
 * Update repository — single source of truth.
 *
 * Both the electron-builder `publish` block (which bakes the feed URL into
 * app-update.yml at build time) and the in-app changelog fetch read these
 * values, so a fork only has to change them here.
 *
 * This file is required from `electron-builder.config.js` at build time and
 * from the main process at runtime; keep it dependency-free.
 */

const UPDATE_REPO = {
  owner: 'eperfecto',
  repo: 'claude-terminal'
};

module.exports = { UPDATE_REPO };
