import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import { WebSocket } from 'ws';
import { store, UserSession } from '../store/store';
import { config } from '../config';
import { projectManager } from './ProjectManager';
import { FileWatcher } from './FileWatcher';

interface ActiveSession {
  id: string;
  userName: string;
  projectName: string;
  abortController: AbortController;
  messageQueue: ReturnType<typeof createMessageQueue>;
  streamClients: Set<WebSocket>;
  status: 'running' | 'idle' | 'error';
  /** Id the SDK stamps on its events and transcript; see UserSession.sdkSessionId. */
  sdkSessionId?: string;
  changedFiles: Set<string>;
  fileWatcher: FileWatcher;
  closing?: boolean;
}

function createMessageQueue(onIdle?: () => void) {
  const queue: any[] = [];
  let waitResolve: ((val: any) => void) | null = null;
  let done = false;
  let pullCount = 0;

  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          pullCount++;
          if (pullCount > 1 && onIdle) onIdle();
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift(), done: false });
          }
          if (done) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<any>(resolve => { waitResolve = resolve; });
        },
        return() {
          done = true;
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };

  return {
    push(message: any) {
      if (waitResolve) {
        const resolve = waitResolve;
        waitResolve = null;
        resolve({ value: message, done: false });
      } else {
        queue.push(message);
      }
    },
    close() {
      done = true;
      if (waitResolve) {
        const resolve = waitResolve;
        waitResolve = null;
        resolve({ value: undefined, done: true });
      }
    },
    iterable
  };
}


export interface LiveSessionInput {
  id: string;
  projectName: string;
  status: string;
}

export interface SessionListEntry {
  id: string;
  projectName: string;
  status: string;
  createdAt: number | null;
  lastActivity: number | null;
  model: string | null;
  sdkSessionId?: string;
}

/**
 * The sessions the API reports: the ones still running in this process, plus the
 * ones whose process is gone but whose conversation is still on disk.
 *
 * Deriving the list from the live Map alone meant a restart erased it, even
 * though sdkSessionId was persisted precisely so the transcript could be found
 * again. A session that is no longer live is reported as `resumable` rather than
 * with its last persisted status — repeating `running` for a dead process offers
 * a chat that can never answer.
 *
 * Orphans past the session timeout are dropped: nothing closes them, because the
 * stale-session sweep only sees the live Map, so without this they accumulate on
 * every restart.
 */
export function mergeSessionList(
  live: LiveSessionInput[],
  stored: UserSession[],
  now: number,
  maxAgeMs: number,
): SessionListEntry[] {
  const byId = new Map(stored.map(s => [s.id, s]));
  const liveIds = new Set(live.map(s => s.id));

  const result: SessionListEntry[] = live.map(session => {
    const meta = byId.get(session.id);
    return {
      id: session.id,
      projectName: session.projectName,
      status: session.status,
      createdAt: meta?.createdAt ?? null,
      lastActivity: meta?.lastActivity ?? null,
      model: meta?.model ?? null,
    };
  });

  for (const meta of stored) {
    if (liveIds.has(meta.id)) continue;
    // No sdk id means no transcript key, so there is nothing to resume into.
    if (!meta.sdkSessionId) continue;
    if (now - (meta.lastActivity || 0) > maxAgeMs) continue;
    result.push({
      id: meta.id,
      projectName: meta.projectName,
      status: 'resumable',
      createdAt: meta.createdAt ?? null,
      lastActivity: meta.lastActivity ?? null,
      model: meta.model ?? null,
      sdkSessionId: meta.sdkSessionId,
    });
  }

  return result;
}


/**
 * Clear the 'running' a restart left behind on disk.
 *
 * Nothing else does: persistSessionMeta writes the status while the process is
 * alive and the process cannot write anything on its way out. The admin TUI
 * counts these entries, so a stale 'running' inflates its active-session count
 * for as long as the entry survives. 'error' is left alone — that status stays
 * true after a restart.
 */
export function demoteOrphanedSessions(stored: UserSession[]): { sessions: UserSession[]; changed: boolean } {
  let changed = false;
  const sessions = stored.map(session => {
    if (session.status !== 'running') return session;
    changed = true;
    return { ...session, status: 'resumable' as const };
  });
  return { sessions, changed };
}

export class SessionManager {
  private sessions: Map<string, ActiveSession> = new Map();
  private sdk: any = null;
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Begin periodic cleanup of stale sessions. Called once at server start. */
  start(): void {
    this._reconcileStoredSessions().catch(err => {
      console.error('[SessionManager] Could not reconcile stored sessions:', err.message);
    });

    if (!this._cleanupTimer) {
      this._cleanupTimer = setInterval(() => this._cleanupStaleSessions(), 15 * 60_000);
      this._cleanupTimer.unref();
    }
  }

  /**
   * No session can be running in a process that has just started, so any stored
   * entry still claiming it is a leftover from the previous one.
   */
  private async _reconcileStoredSessions(): Promise<void> {
    const users = await store.listUsers();
    for (const name of users) {
      const user = await store.getUser(name);
      if (!user) continue;
      const { sessions, changed } = demoteOrphanedSessions(user.sessions);
      if (!changed) continue;
      user.sessions = sessions;
      await store.saveUser(name, user);
      console.log(`[SessionManager] Reconciled stored sessions for ${name}`);
    }
  }

  private async _cleanupStaleSessions(): Promise<void> {
    const maxAge = config.sessionTimeoutHours * 60 * 60 * 1000;
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status !== 'running') {
        const meta = this._getUserSessionMeta(session.userName, id);
        const lastActivity = meta?.lastActivity || 0;
        if (now - lastActivity > maxAge) {
          console.log(`[Session ${id}] Closing stale session (idle ${Math.round((now - lastActivity) / 3600000)}h)`);
          await this.closeSession(id);
        }
      }
    }
  }

  private async loadSDK() {
    if (!this.sdk) {
      this.sdk = await import('@anthropic-ai/claude-agent-sdk');
    }
    return this.sdk;
  }

  private getSdkCliPath(): string {
    try {
      return require.resolve('@anthropic-ai/claude-agent-sdk/cli.js');
    } catch {
      throw new Error('Claude Agent SDK not found. Install @anthropic-ai/claude-agent-sdk');
    }
  }

  async createSession(userName: string, projectName: string, prompt: string, model?: string, effort?: string, resumeSessionId?: string): Promise<string> {
    // Check project exists
    const exists = await projectManager.projectExists(userName, projectName);
    if (!exists) throw new Error(`Project "${projectName}" does not exist`);

    // Check session limit
    const running = Array.from(this.sessions.values()).filter(s => s.status === 'running');
    if (running.length >= config.maxSessions) {
      throw new Error(`Max concurrent sessions reached (${config.maxSessions})`);
    }

    // Verify user has Claude credentials
    const userHome = store.userHomePath(userName);
    const credPath = path.join(userHome, '.claude', '.credentials.json');
    if (!fs.existsSync(credPath)) {
      throw new Error(`User "${userName}" has not authenticated Claude. Run: docker exec -it ct-cloud node dist/cli.js user setup ${userName}`);
    }

    const sdk = await this.loadSDK();
    const sessionId = uuid();
    const cwd = store.getProjectPath(userName, projectName);

    const messageQueue = createMessageQueue(() => {
      this.broadcastToStream(sessionId, { type: 'idle', sessionId });
    });

    // Push initial prompt
    messageQueue.push({
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
      session_id: sessionId,
    });

    const abortController = new AbortController();

    // Start file watcher to capture all filesystem changes
    const fileWatcher = new FileWatcher(cwd);
    fileWatcher.start();

    const activeSession: ActiveSession = {
      id: sessionId,
      userName,
      projectName,
      abortController,
      messageQueue,
      streamClients: new Set(),
      status: 'running',
      changedFiles: new Set(),
      fileWatcher,
    };
    this.sessions.set(sessionId, activeSession);

    // Update user.json
    await this.persistSessionMeta(userName, sessionId, projectName, 'running', model);

    // Start SDK query in background with per-user environment
    const options: any = {
      cwd,
      abortController,
      maxTurns: 100,
      includePartialMessages: true,
      permissionMode: 'bypassPermissions',
      pathToClaudeCodeExecutable: this.getSdkCliPath(),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      stderr: (data: string) => { console.error(`[Session ${sessionId}] ${data}`); },
      env: {
        ...process.env,
        HOME: userHome,
        GIT_CONFIG_GLOBAL: path.join(userHome, '.gitconfig'),
      },
    };

    if (model) options.model = model;
    if (effort) options.effort = effort;
    if (resumeSessionId) options.resume = resumeSessionId;

    console.log(`[Session ${sessionId}] Creating session for user="${userName}" project="${projectName}" model="${model || 'default'}" cwd="${cwd}"`);

    let queryStream: AsyncIterable<any>;
    try {
      queryStream = sdk.query({
        prompt: messageQueue.iterable,
        options,
      });
      console.log(`[Session ${sessionId}] SDK query started`);
    } catch (err: any) {
      console.error(`[Session ${sessionId}] SDK query failed to start:`, err.message);
      throw err;
    }

    this.processStream(sessionId, queryStream).catch(err => {
      console.error(`[Session ${sessionId}] Unhandled processStream error:`, err.message);
    });

    // Touch project activity
    await projectManager.touchProject(userName, projectName);

    return sessionId;
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    console.log(`[Session ${sessionId}] Received message: "${message.slice(0, 100)}"`);

    session.messageQueue.push({
      type: 'user',
      message: { role: 'user', content: message },
      parent_tool_use_id: null,
      session_id: sessionId,
    });
  }

  async interruptSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.abortController.abort();
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.closing = true;
    session.abortController.abort();
    session.messageQueue.close();
    session.fileWatcher.stop();

    // Merge watcher changes into session before closing
    for (const f of session.fileWatcher.getChangedFiles()) {
      session.changedFiles.add(f);
    }
    if (session.changedFiles.size > 0) {
      await this.persistChangedFiles(session);
    }

    // Close all WS stream clients
    for (const ws of session.streamClients) {
      ws.close(1000, 'Session closed');
    }

    // Update user.json before removing from map so session reference is still valid
    const user = await store.getUser(session.userName);
    if (user) {
      user.sessions = user.sessions.filter(s => s.id !== sessionId);
      await store.saveUser(session.userName, user);
    }

    this.sessions.delete(sessionId);
  }

  addStreamClient(sessionId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[Stream] Client tried to connect to unknown session ${sessionId}`);
      return false;
    }
    session.streamClients.add(ws);
    console.log(`[Stream] Client connected to session ${sessionId} (${session.streamClients.size} clients)`);
    ws.on('close', () => {
      session.streamClients.delete(ws);
      console.log(`[Stream] Client disconnected from session ${sessionId} (${session.streamClients.size} clients)`);
    });
    return true;
  }

  listUserSessions(userName: string): SessionListEntry[] {
    const live: LiveSessionInput[] = [];
    for (const [, session] of this.sessions) {
      if (session.userName === userName) {
        live.push({ id: session.id, projectName: session.projectName, status: session.status });
      }
    }
    let stored: UserSession[] = [];
    try {
      stored = store.getUserSync(userName)?.sessions ?? [];
    } catch {
      stored = [];
    }
    return mergeSessionList(live, stored, Date.now(), config.sessionTimeoutHours * 60 * 60 * 1000);
  }

  private _getUserSessionMeta(userName: string, sessionId: string): import('../store/store').UserSession | null {
    try {
      const user = store.getUserSync(userName);
      return user?.sessions.find(s => s.id === sessionId) ?? null;
    } catch {
      return null;
    }
  }

  isUserSession(sessionId: string, userName: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.userName === userName;
  }

  private _encodeProjectPath(projectPath: string): string {
    const MAX_LEN = 200;
    const encoded = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
    if (encoded.length <= MAX_LEN) return encoded;
    // DJB2-style hash to match Claude Code's encoding for long paths
    let hash = 0;
    for (let i = 0; i < projectPath.length; i++) {
      hash = ((hash << 5) - hash + projectPath.charCodeAt(i)) | 0;
    }
    return `${encoded.slice(0, MAX_LEN)}-${Math.abs(hash).toString(36)}`;
  }

  async listPastSessions(userName: string, projectName: string): Promise<Array<{ sessionId: string; cloudSessionId?: string; firstPrompt: string; modified: string; messageCount: number }>> {
    const projectPath = store.getProjectPath(userName, projectName);
    const userHome = store.userHomePath(userName);
    const encoded = this._encodeProjectPath(projectPath);
    const sessionsDir = path.join(userHome, '.claude', 'projects', encoded);

    let files: string[];
    try {
      files = await fs.promises.readdir(sessionsDir);
    } catch {
      return [];
    }

    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    if (!jsonlFiles.length) return [];

    const HEAD_BYTES = 8192; // Read only first 8KB to extract session metadata

    const results = await Promise.all(jsonlFiles.map(async (file) => {
      const filePath = path.join(sessionsDir, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size < 200) return null;

        // Read only the first chunk instead of the entire file
        const fd = await fs.promises.open(filePath, 'r');
        const buf = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
        await fd.read(buf, 0, buf.length, 0);
        await fd.close();

        const head = buf.toString('utf-8');
        // Only parse complete lines (drop the last partial line)
        const lastNewline = head.lastIndexOf('\n');
        const lines = (lastNewline > 0 ? head.slice(0, lastNewline) : head).split('\n');

        let sessionId = '';
        let firstPrompt = '';
        let isSidechain = false;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'user' && !firstPrompt) {
              sessionId = obj.sessionId || '';
              isSidechain = obj.isSidechain || false;
              const c = obj.message?.content;
              if (typeof c === 'string') firstPrompt = c;
              else if (Array.isArray(c)) {
                const tb = c.find((b: any) => b.type === 'text');
                if (tb) firstPrompt = tb.text;
              }
              break; // Got what we need
            }
          } catch {}
        }

        if (isSidechain || !sessionId) return null;

        // Estimate message count from file size (~2KB per message on average)
        const estimatedMessages = Math.max(1, Math.round(stat.size / 2048));

        return {
          sessionId,
          firstPrompt: firstPrompt.slice(0, 200),
          modified: stat.mtime.toISOString(),
          messageCount: estimatedMessages,
        };
      } catch {
        return null;
      }
    }));

    // A transcript on disk only knows the SDK's id. Hand back the cloud id too
    // when a session still claims it, so the client can recognise a history
    // entry it is already showing as a live chat.
    const user = await store.getUser(userName);
    const cloudIdBySdkId = new Map<string, string>();
    for (const s of user?.sessions ?? []) {
      if (s.sdkSessionId) cloudIdBySdkId.set(s.sdkSessionId, s.id);
    }

    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map(r => ({ ...r, cloudSessionId: cloudIdBySdkId.get(r.sessionId) }))
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, 30);
  }

  private async processStream(sessionId: string, queryStream: AsyncIterable<any>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      let eventCount = 0;
      for await (const event of queryStream) {
        if (!this.sessions.has(sessionId) || session.closing) break;
        eventCount++;
        if (eventCount <= 3 || eventCount % 50 === 0) {
          console.log(`[Session ${sessionId}] Event #${eventCount}: type=${event?.type}`);
        }
        this.trackFileChanges(session, event);
        // The SDK reveals its own session id on its events. Capture it once:
        // it is the only key that finds this conversation's transcript later.
        if (!session.sdkSessionId && event?.session_id) {
          session.sdkSessionId = event.session_id;
          this.persistSessionMeta(session.userName, sessionId, session.projectName, session.status)
            .catch(() => { /* metadata only — never break the stream over it */ });
        }
        this.broadcastToStream(sessionId, { type: 'event', sessionId, event });
      }
      console.log(`[Session ${sessionId}] Stream ended after ${eventCount} events, status=idle`);
      if (session) session.status = 'idle';
      this.broadcastToStream(sessionId, { type: 'done', sessionId });
    } catch (err: any) {
      console.error(`[Session ${sessionId}] Stream error:`, err.message);
      if (session) session.status = 'error';
      this.broadcastToStream(sessionId, { type: 'error', sessionId, error: err.message });
    }

    // Stop watcher and merge its changes
    if (session) {
      session.fileWatcher.stop();
      for (const f of session.fileWatcher.getChangedFiles()) {
        session.changedFiles.add(f);
      }
    }

    // Persist changed files for sync
    if (session && session.changedFiles.size > 0) {
      await this.persistChangedFiles(session);
    }

    // Update meta
    if (session) {
      await this.persistSessionMeta(session.userName, sessionId, session.projectName, session.status);
    }
  }

  private trackFileChanges(session: ActiveSession, event: any): void {
    // SDK assistant messages contain tool_use blocks with file paths
    if (event?.type === 'assistant' && event?.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit')) {
          const filePath = block.input?.file_path;
          if (filePath) {
            const cwd = store.getProjectPath(session.userName, session.projectName);
            const resolved = path.resolve(cwd, filePath);
            const relative = path.relative(cwd, resolved);
            // Only track files inside the project directory
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
              session.changedFiles.add(relative);
            }
          }
        }
      }
    }
  }

  private async persistChangedFiles(session: ActiveSession): Promise<void> {
    const projectPath = store.getProjectPath(session.userName, session.projectName);
    const changesDir = path.join(projectPath, '.ct-cloud');
    await fs.promises.mkdir(changesDir, { recursive: true });

    const changesFile = path.join(changesDir, `changes-${session.id}.json`);
    await fs.promises.writeFile(changesFile, JSON.stringify({
      sessionId: session.id,
      projectName: session.projectName,
      changedFiles: Array.from(session.changedFiles),
      completedAt: Date.now(),
      synced: false,
    }), 'utf-8');
  }

  private broadcastToStream(sessionId: string, data: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const msg = JSON.stringify(data);

    for (const ws of session.streamClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch { /* client disconnected */ }
      }
    }
  }

  /**
   * The conversation of a session, read back from the SDK transcript on disk.
   *
   * Sessions live on the server, so every device must be able to open the same
   * one. Nothing else can serve that: addStreamClient() has no replay buffer,
   * and listPastSessions() returns metadata only.
   */
  async getTranscript(userName: string, sessionId: string): Promise<Array<{ role: string; content: string }>> {
    const live = this.sessions.get(sessionId);
    let sdkId = live?.sdkSessionId;
    let projectName = live?.projectName;

    if (!sdkId || !projectName) {
      const user = await store.getUser(userName);
      const meta = user?.sessions.find(s => s.id === sessionId);
      sdkId = sdkId || meta?.sdkSessionId;
      projectName = projectName || meta?.projectName;
    }

    // A session picked out of the history list has no cloud id behind it:
    // listPastSessions() reads the SDK's own id out of the .jsonl, and that id
    // names no entry in user.sessions. Take the caller's id at face value.
    if (!sdkId) sdkId = sessionId;

    const projectsRoot = path.join(store.userHomePath(userName), '.claude', 'projects');
    const known = projectName
      ? path.join(projectsRoot, this._encodeProjectPath(store.getProjectPath(userName, projectName)))
      : null;

    // The owning project is a hint, not a guarantee — it can be missing, or
    // stale after a rename — so the other projects stay as a fallback.
    const dirs = [known, ...(await this._listTranscriptDirs(projectsRoot))]
      .filter((d): d is string => !!d)
      .filter((d, i, all) => all.indexOf(d) === i);

    for (const dir of dirs) {
      const messages = await this._readTranscript(dir, sdkId);
      if (messages) return messages;
    }

    return [];
  }

  /** Every per-project transcript directory Claude Code has written for a user. */
  private async _listTranscriptDirs(projectsRoot: string): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(projectsRoot, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => path.join(projectsRoot, e.name));
    } catch {
      return [];
    }
  }

  /**
   * The conversation `sdkId` names inside one directory, or null if it is not
   * there. Only the user/assistant text survives: tool calls and their results
   * are noise on a phone screen, and the sidechains belong to subagents.
   */
  private async _readTranscript(
    sessionsDir: string,
    sdkId: string,
  ): Promise<Array<{ role: string; content: string }> | null> {
    let files: string[];
    try {
      files = (await fs.promises.readdir(sessionsDir)).filter(f => f.endsWith('.jsonl'));
    } catch {
      return null;
    }

    // The file is usually named after the SDK id, but the id inside the file is
    // what listPastSessions() trusts, so fall back to scanning rather than
    // returning nothing when the naming differs.
    const preferred = `${sdkId}.jsonl`;
    const ordered = files.includes(preferred) ? [preferred, ...files.filter(f => f !== preferred)] : files;

    for (const file of ordered) {
      let raw: string;
      try {
        raw = await fs.promises.readFile(path.join(sessionsDir, file), 'utf-8');
      } catch {
        continue;
      }

      const messages: Array<{ role: string; content: string }> = [];
      let matched = false;

      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.sessionId && obj.sessionId !== sdkId) { matched = false; break; }
        if (obj.sessionId === sdkId) matched = true;
        if (obj.isSidechain) continue;

        const role = obj.type === 'user' ? 'user' : obj.type === 'assistant' ? 'assistant' : null;
        if (!role) continue;

        const c = obj.message?.content;
        let text = '';
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) text = c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        if (text.trim()) messages.push({ role, content: text });
      }

      if (matched) return messages;
    }

    return null;
  }

  private async persistSessionMeta(userName: string, sessionId: string, projectName: string, status: string, model?: string): Promise<void> {
    const user = await store.getUser(userName);
    if (!user) return;

    const existing = user.sessions.findIndex(s => s.id === sessionId);
    const entry: UserSession = {
      id: sessionId,
      sdkSessionId: this.sessions.get(sessionId)?.sdkSessionId
        || (existing >= 0 ? user.sessions[existing].sdkSessionId : undefined),
      projectName,
      status: status as 'idle' | 'running' | 'error',
      model: model || 'claude-sonnet-4-6',
      createdAt: existing >= 0 ? user.sessions[existing].createdAt : Date.now(),
      lastActivity: Date.now(),
    };

    if (existing >= 0) {
      user.sessions[existing] = entry;
    } else {
      user.sessions.push(entry);
    }
    await store.saveUser(userName, user);
  }
}

export const sessionManager = new SessionManager();
