# Claude Terminal Cloud

Self-hosted cloud server for [Claude Terminal](https://github.com/Sterll/claude-terminal).

## What it does

- **Cloud Projects**: Upload projects, run Agent SDK sessions headless — code from mobile without a desktop
- **Mobile PWA**: Served from this server and talks only to it, so a phone never needs to reach your desktop

## Quick Start

### Docker (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Sterll/claude-terminal/main/cloud/install.sh | bash
```

Or manually:

```bash
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/Sterll/claude-terminal.git ct-cloud
cd ct-cloud && git sparse-checkout set cloud
cd cloud

cp .env.example .env
# Edit .env: set PUBLIC_URL to your domain

mkdir -p data/users
docker compose up -d
```

### Create a user

```bash
docker exec -it ct-cloud node dist/cli.js user add <name>
```

This prints an API key. Paste it in Claude Terminal → Connectivity → Cloud, or in the mobile PWA.

### Node.js (no Docker)

```bash
cd cloud
npm install
npm run build
node dist/cli.js user add <name>
node dist/cli.js start
```

## CLI Reference

```bash
ct-cloud user add <name>         # Create user, get API key
ct-cloud user list               # List users with stats
ct-cloud user remove <name>      # Delete user + data
ct-cloud user reset-key <name>   # Regenerate API key

ct-cloud status                  # Server info
ct-cloud start                   # Start server
```

## Configuration (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3800` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `PUBLIC_URL` | `http://localhost:3800` | Public URL (for mobile connections) |
| `CLOUD_ENABLED` | `true` | `false` = disable the cloud API (no cloud sessions) |
| `MAX_PROJECTS_PER_USER` | `20` | Max projects per user |
| `MAX_SESSIONS` | `5` | Total concurrent Agent SDK sessions |
| `CLAUDE_CREDENTIALS_PATH` | `~/.claude/.credentials.json` | Claude OAuth credentials |
| `MAX_UPLOAD_SIZE` | `100mb` | Max zip upload size |
| `SESSION_TIMEOUT_HOURS` | `24` | Session auto-cleanup timeout |

## Reverse Proxy

See [nginx.conf.example](nginx.conf.example) and [caddy.example](caddy.example) for HTTPS setup.

## API

### REST API

All routes require `Authorization: Bearer <API_KEY>`.

```
GET    /health                       Server health check
POST   /api/projects                 Upload project (multipart zip)
GET    /api/projects                 List projects
DELETE /api/projects/:name           Delete project
POST   /api/projects/:name/sync     Re-upload project zip
POST   /api/sessions                Create Agent SDK session
GET    /api/sessions                List sessions
POST   /api/sessions/:id/send       Send message to session
POST   /api/sessions/:id/interrupt  Interrupt session
DELETE /api/sessions/:id            Close session
WS     /api/sessions/:id/stream     Real-time session events
```

## Architecture

```
Desktop (Electron)  ─REST→  Cloud Server  ←─REST + per-session WS─  Mobile PWA
                             ├─ REST API (projects CRUD, sessions)
                             ├─ WS /api/sessions/:id/stream (live session events)
                             ├─ Agent SDK headless (cloud coding)
                             └─ CLI admin (user management)
```

## Data Storage

```
data/
├── server.json           # Server config (auto-generated)
└── users/
    └── <name>/
        ├── user.json     # User metadata, API key, sessions
        └── projects/
            └── <project>/  # Project files
```

All data is stored as JSON files with atomic writes (temp file + rename).
