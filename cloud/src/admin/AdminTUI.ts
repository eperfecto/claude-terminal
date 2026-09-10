/**
 * AdminTUI — Interactive full-screen admin dashboard.
 * Orchestrates screen, input, tabs, and refresh timers.
 *
 * Usage: `ct-cloud admin`
 */

import { Screen } from './Screen';
import { InputHandler } from './InputHandler';
import { c, style, hline, fmtDuration, box } from './ansi';
import { config } from '../config';
import { OverviewTab } from './tabs/OverviewTab';
import { UsersTab } from './tabs/UsersTab';
import { LogsTab } from './tabs/LogsTab';

const TAB_NAMES = ['Overview', 'Users', 'Logs'];

interface Tab {
  load(): Promise<void>;
  render(): void;
  onKey(key: string): void;
}

export class AdminTUI {
  private screen: Screen;
  private input: InputHandler;
  private tabs: Tab[];
  private currentTab: number = 0;
  private running: boolean = false;
  private showHelp: boolean = false;
  private serverUrl: string;
  private startedAt: number = Date.now();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private renderTimer: ReturnType<typeof setInterval> | null = null;
  private dirty: boolean = true;

  constructor(serverUrl?: string) {
    this.serverUrl = serverUrl || `http://localhost:${config.port}`;
    this.screen = new Screen();
    this.input = new InputHandler();

    const overviewTab = new OverviewTab(this.screen, this.serverUrl);
    const usersTab = new UsersTab(this.screen);
    const logsTab = new LogsTab(this.screen, this.serverUrl);

    usersTab.setRenderCallback(() => { this.dirty = true; });

    this.tabs = [overviewTab, usersTab, logsTab];
  }

  async start(): Promise<void> {
    this.running = true;

    // Enter TUI mode
    this.screen.enter();

    // Handle resize
    process.stdout.on('resize', () => {
      this.screen.resize();
      this.dirty = true;
    });

    // Key handling
    this.input.onKey((key) => this.handleKey(key));
    this.input.start();

    // Initial load
    await this.loadActiveTab();

    // Render loop (10 FPS)
    this.renderTimer = setInterval(() => {
      if (this.dirty) {
        this.render();
        this.dirty = false;
      }
    }, 100);

    // Auto-refresh (2s)
    this.refreshTimer = setInterval(async () => {
      await this.loadActiveTab();
      this.dirty = true;
    }, 2000);

    // First render
    this.dirty = true;

    // Keep process alive
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  private handleKey(key: string): void {
    // Help overlay
    if (this.showHelp) {
      this.showHelp = false;
      this.dirty = true;
      return;
    }

    // Global keys
    switch (key) {
      case 'ctrl-c':
      case 'q':
        this.quit();
        return;
      case 'tab':
        this.switchTab((this.currentTab + 1) % TAB_NAMES.length);
        return;
      case 'shift-tab':
        this.switchTab((this.currentTab - 1 + TAB_NAMES.length) % TAB_NAMES.length);
        return;
      case '1': this.switchTab(0); return;
      case '2': this.switchTab(1); return;
      case '3': this.switchTab(2); return;
      case '4': this.switchTab(3); return;
      case '?':
        this.showHelp = !this.showHelp;
        this.dirty = true;
        return;
    }

    // Delegate to active tab
    this.tabs[this.currentTab].onKey(key);
    this.dirty = true;
  }

  private async switchTab(index: number): Promise<void> {
    if (index === this.currentTab) return;
    this.currentTab = index;
    await this.loadActiveTab();
    this.dirty = true;
  }

  private async loadActiveTab(): Promise<void> {
    try {
      await this.tabs[this.currentTab].load();
    } catch { /* ignore load errors */ }
  }

  private render(): void {
    this.screen.clear();

    // ── Header ──
    const version = '0.1.0';
    const title = style('  Claude Terminal Cloud', c.bold, c.amber) + style(' — Admin', c.bold, c.white);
    const uptime = style(`Uptime: ${fmtDuration(Date.now() - this.startedAt)}`, c.gray);
    this.screen.writeAt(1, 1, title);
    this.screen.writeAt(1, this.screen.width - fmtDuration(Date.now() - this.startedAt).length - 10, uptime);

    // ── Separator ──
    this.screen.writeStyled(2, 1, hline(this.screen.width - 1), c.gray);

    // ── Tab Bar ──
    let x = 3;
    for (let i = 0; i < TAB_NAMES.length; i++) {
      const active = i === this.currentTab;
      const label = `[${i + 1}] ${TAB_NAMES[i]}`;
      if (active) {
        this.screen.writeAt(3, x, style(label, c.bold, c.amber));
      } else {
        this.screen.writeAt(3, x, style(label, c.gray));
      }
      x += label.length + 3;
    }

    // ── Separator ──
    this.screen.writeStyled(4, 1, hline(this.screen.width - 1), c.gray);

    // ── Tab Content ──
    this.tabs[this.currentTab].render();

    // ── Footer ──
    const footer = style('q', c.bold, c.amber) + style(':quit  ', c.gray)
      + style('r', c.bold, c.amber) + style(':refresh  ', c.gray)
      + style('?', c.bold, c.amber) + style(':help  ', c.gray)
      + style('Tab', c.bold, c.amber) + style('/1-4:switch', c.gray);
    this.screen.writeAt(this.screen.height, 3, footer);

    // ── Help Overlay ──
    if (this.showHelp) {
      this.renderHelp();
    }
  }

  private renderHelp(): void {
    const s = this.screen;
    const w = 52;
    const h = 18;
    const x = Math.floor((s.width - w) / 2);
    const y = Math.floor((s.height - h) / 2);

    const r = s.drawBoxFilled(y, x, w, h, 'Keyboard Shortcuts');

    const shortcuts = [
      ['q / Ctrl+C', 'Quit'],
      ['Tab / Shift+Tab', 'Next / previous tab'],
      ['1-4', 'Jump to tab'],
      ['↑ / ↓', 'Navigate lists / scroll'],
      ['PgUp / PgDn', 'Scroll page (Logs)'],
      ['Enter', 'Action on selected item'],
      ['', ''],
      ['USERS TAB', ''],
      ['A', 'Add new user'],
      ['D', 'Delete selected user'],
      ['R', 'Reset API key'],
      ['', ''],
      ['LOGS TAB', ''],
      ['/', 'Filter logs'],
      ['F', 'Follow mode (auto-scroll)'],
      ['C', 'Clear filter'],
    ];

    for (let i = 0; i < shortcuts.length && i < h - 2; i++) {
      const [key, desc] = shortcuts[i];
      if (!key && !desc) continue;
      if (!desc) {
        s.writeAt(r + i, x + 3, style(key, c.bold, c.amber));
      } else {
        s.writeAt(r + i, x + 3, style(key.padEnd(20), c.bold, c.white) + style(desc, c.gray));
      }
    }
  }

  private quit(): void {
    this.running = false;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.renderTimer) clearInterval(this.renderTimer);
    this.input.stop();
    this.screen.exit();
    console.log('');
  }
}
