/**
 * OverviewTab — Server status & statistics.
 * Auto-refreshes every 2s.
 */

import { Screen } from '../Screen';
import { c, style, padR, fmtDuration } from '../ansi';
import { config } from '../../config';
import { store } from '../../store/store';

interface HealthData {
  status: string;
  version: string;
  cloud: boolean;
}

export class OverviewTab {
  private screen: Screen;
  private serverUrl: string;
  private health: HealthData | null = null;
  private userCount: number = 0;
  private sessionCount: number = 0;
  private startedAt: number = Date.now();

  constructor(screen: Screen, serverUrl: string) {
    this.screen = screen;
    this.serverUrl = serverUrl;
  }

  async load(): Promise<void> {
    // Fetch health
    try {
      const res = await fetch(`${this.serverUrl}/health`);
      this.health = await res.json() as HealthData;
    } catch {
      this.health = null;
    }

    // Count users
    const users = await store.listUsers();
    this.userCount = users.length;

    // Count active sessions
    let running = 0;
    for (const name of users) {
      const user = await store.getUser(name);
      if (user) running += user.sessions.filter(s => s.status === 'running').length;
    }
    this.sessionCount = running;
  }

  render(): void {
    const s = this.screen;
    const w = Math.min(s.width - 4, 64);
    const col = 3;

    // ── Server Status Box ──
    const r1 = s.drawBox(5, col, w, 8, 'Server Status');
    const online = this.health !== null;
    const statusStr = online
      ? style(' ONLINE ', c.bold, c.bgGreen, c.black)
      : style(' OFFLINE ', c.bold, c.bgRed, c.white);

    s.writeAt(r1 + 0, col + 2, `${style('Status:', c.gray)}    ${statusStr}`);
    s.writeAt(r1 + 1, col + 2, `${style('Port:', c.gray)}      ${style(String(config.port), c.white)}`);
    s.writeAt(r1 + 2, col + 2, `${style('URL:', c.gray)}       ${style(config.publicUrl, c.cyan)}`);
    s.writeAt(r1 + 3, col + 2, `${style('Cloud:', c.gray)}     ${config.cloudEnabled ? style('enabled', c.green) : style('disabled', c.yellow)}`);
    s.writeAt(r1 + 4, col + 2, `${style('Uptime:', c.gray)}    ${style(fmtDuration(Date.now() - this.startedAt), c.white)}`);
    s.writeAt(r1 + 5, col + 2, `${style('Version:', c.gray)}   ${style(this.health?.version || '?', c.white)}`);

    // ── Statistics Box ──
    const r2 = s.drawBox(14, col, w, 4, 'Statistics');

    s.writeAt(r2 + 0, col + 2, `${style('Users:', c.gray)}           ${style(String(this.userCount), c.bold, c.white)}`);
    s.writeAt(r2 + 1, col + 2, `${style('Sessions:', c.gray)}        ${this.sessionCount > 0 ? style(`${this.sessionCount} running`, c.green) : style('0', c.gray)}`);
  }

  onKey(_key: string): void {
    // No interactive keys
  }

  private colorNum(n: number): string {
    return n > 0 ? style(String(n), c.bold, c.green) : style('0', c.gray);
  }
}
