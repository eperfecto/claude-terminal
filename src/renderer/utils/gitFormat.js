/**
 * Git display helpers.
 *
 * Kept separate from renderer.js so the decision of when a count is worth
 * showing is testable — renderer.js itself is not importable from tests.
 */

/**
 * Decide how to badge the pull and push buttons from an ahead/behind result.
 *
 * A badge only earns its place when there is something to act on. Zero, a branch
 * with no remote, and a branch not tracking anything all mean "nothing to say" —
 * showing a 0 there would be noise the user has to learn to ignore.
 *
 * @param {{ahead?: number, behind?: number, hasRemote?: boolean, notTracking?: boolean, error?: boolean}|null} aheadBehind
 * @returns {{ahead: number, behind: number, showAhead: boolean, showBehind: boolean}}
 */
function formatAheadBehind(aheadBehind) {
  const empty = { ahead: 0, behind: 0, showAhead: false, showBehind: false };

  if (!aheadBehind || aheadBehind.error) return empty;
  if (aheadBehind.hasRemote === false || aheadBehind.notTracking) return empty;

  const ahead = Number.isFinite(aheadBehind.ahead) ? aheadBehind.ahead : 0;
  const behind = Number.isFinite(aheadBehind.behind) ? aheadBehind.behind : 0;

  return {
    ahead,
    behind,
    showAhead: ahead > 0,
    showBehind: behind > 0
  };
}

module.exports = { formatAheadBehind };
