const { formatAheadBehind } = require('../../src/renderer/utils/gitFormat');

describe('formatAheadBehind', () => {
  test('shows both counts when there is work in each direction', () => {
    expect(formatAheadBehind({ ahead: 2, behind: 5, hasRemote: true })).toEqual({
      ahead: 2, behind: 5, showAhead: true, showBehind: true
    });
  });

  test('hides a count that is zero', () => {
    const result = formatAheadBehind({ ahead: 0, behind: 3, hasRemote: true });
    expect(result.showAhead).toBe(false);
    expect(result.showBehind).toBe(true);
  });

  test('hides everything when the branch has no remote', () => {
    expect(formatAheadBehind({ ahead: 4, behind: 0, hasRemote: false })).toEqual({
      ahead: 0, behind: 0, showAhead: false, showBehind: false
    });
  });

  test('hides everything when the branch tracks nothing', () => {
    // A local branch with commits but no upstream: git reports 0/0 anyway, and a
    // badge here would imply a comparison that was never made.
    const result = formatAheadBehind({ ahead: 0, behind: 0, hasRemote: true, notTracking: true });
    expect(result.showAhead).toBe(false);
    expect(result.showBehind).toBe(false);
  });

  test('hides everything on an error or a missing result', () => {
    expect(formatAheadBehind(null).showBehind).toBe(false);
    expect(formatAheadBehind(undefined).showAhead).toBe(false);
    expect(formatAheadBehind({ error: true, message: 'boom' }).showBehind).toBe(false);
  });

  test('treats non-numeric counts as zero rather than rendering NaN', () => {
    expect(formatAheadBehind({ ahead: undefined, behind: null, hasRemote: true })).toEqual({
      ahead: 0, behind: 0, showAhead: false, showBehind: false
    });
  });
});
