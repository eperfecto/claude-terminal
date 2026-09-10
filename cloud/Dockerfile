FROM node:22-slim AS build

WORKDIR /app

COPY cloud/package.json cloud/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

COPY cloud/tsconfig.json ./
COPY cloud/src/ ./src/
RUN npx tsc

FROM node:22-slim

WORKDIR /app

# Install git, gosu (for entrypoint privilege drop), and curl (for Claude CLI)
RUN apt-get update -qq && apt-get install -y -qq curl git gosu && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user (SDK refuses bypassPermissions as root)
RUN groupadd -r claude && useradd -r -g claude -m -d /home/claude -s /bin/bash claude

# Install Claude Code CLI as non-root user
USER claude
RUN NODE_OPTIONS="--max-old-space-size=512" curl -fsSL https://claude.ai/install.sh | bash
USER root

# Symlink claude to /usr/local/bin so docker exec can find it
RUN ln -sf /home/claude/.local/bin/claude /usr/local/bin/claude 2>/dev/null || true

# Machine-wide tooling for sessions. The per-user configuration these produce is
# NOT baked here: it belongs to a user's home inside the data volume, so
# `cli.js user setup` writes it. Only the binaries live in the image.
#
# gentle-ai carries engram, context7, the skills and the SDD components as part
# of its claude-code preset, so this one install covers them.
RUN INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/scripts/install.sh | bash

# codegraph backs the MCP of the same name
RUN npm install -g @colbymchenry/codegraph

COPY cloud/package.json cloud/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY --from=build /app/dist ./dist/
COPY remote-ui/ ./remote-ui/

# The release version, for /health. cloud/package.json is not it: nothing bumps
# that one, so it has reported 0.2.0 across every release.
COPY package.json ./app-version.json

RUN mkdir -p /app/data && chown -R claude:claude /app

# Entrypoint fixes data dir ownership then drops to user claude
COPY cloud/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3800

ENV PATH="/home/claude/.local/bin:$PATH"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/cli.js", "start"]
