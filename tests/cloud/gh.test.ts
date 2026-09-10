/** @jest-environment node */
/**
 * Reusing the GitHub token setup already asks for.
 *
 * `user setup` stores a PAT in ~/.git-credentials so pushes work. The gh CLI can
 * authenticate with that same token, which keeps one secret to rotate instead of
 * two — but only if it is read back correctly. A silently mis-parsed token turns
 * into "gh: not authenticated" inside a session on a phone, with nothing pointing
 * at the cause.
 */

const { parseGitHubToken } = require('../../cloud/src/gh');

test('reads the token out of a git credentials line', () => {
  expect(parseGitHubToken('https://oauth2:ghp_abc123@github.com\n')).toBe('ghp_abc123');
});

test('reads it when other hosts are stored alongside', () => {
  const contents = [
    'https://oauth2:gitlab_token@gitlab.com',
    'https://oauth2:ghp_wanted@github.com',
    '',
  ].join('\n');

  expect(parseGitHubToken(contents)).toBe('ghp_wanted');
});

test('returns empty when github is not in the file', () => {
  expect(parseGitHubToken('https://oauth2:t@gitlab.com\n')).toBe('');
});

test('returns empty for an empty or junk file', () => {
  expect(parseGitHubToken('')).toBe('');
  expect(parseGitHubToken('not a credentials file')).toBe('');
});

test('does not swallow the token when it contains url-ish characters', () => {
  // Fine-grained PATs carry underscores and digits; stopping at the first @ is
  // what matters, since the token itself never contains one.
  expect(parseGitHubToken('https://oauth2:github_pat_11ABC_xyz-789@github.com\n'))
    .toBe('github_pat_11ABC_xyz-789');
});
