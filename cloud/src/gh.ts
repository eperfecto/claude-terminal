/**
 * Making the gh CLI usable inside a session.
 *
 * `user setup` already asks for a GitHub token and stores it in ~/.git-credentials
 * so pushes work. gh authenticates with that same token, so a session gets `gh`
 * without a second prompt and without a second secret to rotate.
 *
 * Deliberately non-interactive: `gh auth login` on its own is a device flow, and
 * setup may run where nothing can display the code. `gh auth setup-git` is NOT
 * run — git already authenticates through the stored credential helper, and
 * setup-git would replace that working configuration with its own.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/** The GitHub token out of a ~/.git-credentials file, or '' when there is none. */
export function parseGitHubToken(contents: string): string {
  const match = contents.match(/https:\/\/[^:]+:([^@]+)@github\.com/);
  return match ? match[1] : '';
}

/** Whether a binary is on PATH, so an optional step can be skipped cleanly. */
export function commandExists(bin: string): boolean {
  try {
    execSync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Point gh at this user's stored token. Reports what happened and never throws:
 * failing to configure gh costs the session that one tool, not the account.
 */
export function configureGhAuth(userHome: string): 'ok' | 'no-gh' | 'no-token' | 'failed' {
  if (!commandExists('gh')) return 'no-gh';

  let token = '';
  try {
    token = parseGitHubToken(fs.readFileSync(path.join(userHome, '.git-credentials'), 'utf-8'));
  } catch {
    return 'no-token';
  }
  if (!token) return 'no-token';

  try {
    execSync('gh auth login --with-token', {
      input: `${token}\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, HOME: userHome },
    });
    return 'ok';
  } catch {
    return 'failed';
  }
}
