/**
 * The release version this server was built from.
 *
 * `cloud/package.json` is NOT it: that version has sat at 0.2.0 across every
 * release because nothing bumps it, which made /health report a number that
 * told you nothing about which build was running. The root package.json IS
 * bumped by the release process, and the Dockerfile copies it in as
 * app-version.json.
 *
 * Outside Docker (npm run dev) that file is absent, so the cloud package
 * version is used as a fallback — honest about being a dev run rather than
 * claiming a release number it does not have.
 */

import fs from 'fs';
import path from 'path';

function read(file: string): string | null {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const version = JSON.parse(raw)?.version;
    return typeof version === 'string' && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

function resolve(): string {
  const appVersion = read(path.resolve(__dirname, '..', 'app-version.json'));
  if (appVersion) return appVersion;
  return read(path.resolve(__dirname, '..', 'package.json')) || 'unknown';
}

export const appVersion: string = resolve();
