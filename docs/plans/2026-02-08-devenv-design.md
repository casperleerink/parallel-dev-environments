# devenv — Isolated Development Environments

## Problem

Developers working on multiple web projects simultaneously face friction:

- Port conflicts across projects (multiple apps want `localhost:3000`)
- Shared browser cookies/storage bleed between projects on `localhost`
- Environment variable collisions
- Context switching between branches requires tearing down and rebuilding state
- AI coding agents (Claude Code, Codex, etc.) need sandboxed environments to work safely in parallel

## Solution

**devenv** is a CLI + web dashboard tool that runs isolated development environments on the developer's local machine using Docker containers. Each environment is a **project + branch** combination with its own filesystem, env vars, and unique local URL — giving full origin isolation.

The primary workflow: developer creates an environment, connects an AI coding agent to the container's terminal, the agent writes code and starts the dev server, and the developer reviews changes through the dashboard. Multiple environments run in parallel without conflicts.

The tool is **agent-agnostic** — it provides infrastructure (containers, terminals, tunneled URLs), not AI integration. What runs inside the container is the developer's choice.

## Architecture

### Four Components

1. **CLI (`devenv`)** — Primary interface. Commands for creating, managing, and connecting to environments. Also runs the local API server that the dashboard communicates with.

2. **Web Dashboard** — React + Vite SPA served on a fixed local port (e.g., `localhost:9000`). Visual environment management: project list, status, tunnel URLs, git diffs, logs.

3. **Container Engine** — Communicates with Docker via the Docker Engine REST API over the Unix socket (`/var/run/docker.sock`). Creates, starts, stops, and manages containers.

4. **Tunnel Service** — Caddy reverse proxy running as a container. Assigns deterministic local hostnames per environment port, providing origin isolation without port conflicts.

### Technical Stack

| Component | Technology |
|---|---|
| CLI | Bun (TypeScript) |
| Dashboard | React + Vite (SPA) |
| Container engine | Docker Engine REST API via Unix socket |
| Reverse proxy | Caddy (runs as a container) |
| Data storage | SQLite via `bun:sqlite` |
| Container config | Dev Containers spec (`devcontainer.json`) |

### Project Structure

```
developer-environments/
├── packages/
│   ├── cli/                # Bun CLI - devenv command
│   │   ├── src/
│   │   │   ├── commands/    # create, start, stop, branch, list, env, shell
│   │   │   ├── docker/      # Docker Engine API client
│   │   │   ├── tunnel/      # Caddy config management
│   │   │   ├── db/          # SQLite storage layer
│   │   │   ├── api/         # Local HTTP API server for dashboard
│   │   │   └── index.ts     # CLI entry point
│   │   └── package.json
│   ├── dashboard/           # React + Vite SPA
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── api/         # Talks to CLI's local API server
│   │   │   └── App.tsx
│   │   └── package.json
│   └── shared/              # Shared types & constants
│       └── src/
└── package.json             # Bun workspace root
```

## Core Concepts

### Project

A project represents a git repository. It can be created from a local path or a remote URL. Projects are the top-level grouping in the dashboard.

### Environment

An environment is a **project + branch** combination. Each environment is a Docker container with:

- The project's code mounted via volume mount (code lives on host, editable normally)
- Its own set of `.env` files at the correct relative paths
- A deterministic local URL via Caddy
- Its own installed packages, tools, and runtime state

Environments persist across start/stop cycles. Manual installs (e.g., `npm i -g bun`) survive until the environment is explicitly deleted.

### Runtime Configuration

Environments use the **Dev Containers spec** for runtime setup:

- If the repo has a `.devcontainer/devcontainer.json`, use it automatically
- If not, the developer picks runtimes during creation (via CLI flags or dashboard UI), and the tool generates a devcontainer config
- The Dev Containers Features system allows composing runtimes declaratively (e.g., Node 20 + Bun + Python 3.12)
- Developers can always install additional tools manually inside the running container, just like on a normal machine

## Data Flow & Lifecycle

### Creating an Environment

**From local repo:**

```
devenv create --repo ~/code/my-saas --branch main
```

1. Registers the project in SQLite (or reuses existing project entry)
2. Creates a git worktree for the specified branch in a managed directory
3. Scans for all `.env` files in the project, copies them into the environment config (preserving relative paths)
4. Detects or generates `devcontainer.json` for runtime setup
5. Builds/pulls the Docker image based on devcontainer config
6. Creates a Docker container with the project directory volume-mounted
7. Registers tunnel routes in Caddy for configured ports
8. Environment appears in dashboard as "stopped"

**From remote repo:**

```
devenv create --repo git@github.com:user/my-saas.git --branch main
```

Same as above, but clones the repo into a managed directory first. No `.env` files to auto-scan, so environment variables must be set manually through the dashboard or CLI.

### Branching an Environment

```
devenv branch my-saas--main feature-auth
```

1. Creates a new git branch from the source environment's current branch
2. Creates a new worktree for the new branch
3. **Copies all `.env` files from the source environment** — no re-entry needed
4. Creates a new container with the same devcontainer config
5. Registers new tunnel routes in Caddy

This is the power move: set up env vars once, branch freely.

### Starting an Environment

```
devenv start my-saas--feature-auth
```

1. Starts the Docker container
2. Runs any setup commands defined in devcontainer config (e.g., `npm install`)
3. Caddy routes become active
4. Developer connects their AI agent or terminal to the container
5. Agent/developer starts the dev server — tunnel URL is live
6. Dashboard shows status "running" with clickable tunnel URLs

### Stopping an Environment

```
devenv stop my-saas--feature-auth
```

1. Stops the Docker container (state is preserved, not deleted)
2. Caddy routes are removed
3. Dashboard shows status "stopped"

## URL Scheme

Each environment gets a **deterministic local URL** via Caddy reverse proxy. URLs are derived from the environment name, so they remain stable across start/stop cycles.

**Single port:**
```
my-saas--main.localhost        → container port 3000
my-saas--feature-auth.localhost → container port 3000
client-project--main.localhost  → container port 3000
```

**Multi-port (future):**
```
my-saas--main.localhost         → container port 3001 (frontend)
my-saas--main--api.localhost    → container port 3000 (backend)
```

`.localhost` domains resolve to `127.0.0.1` automatically in modern browsers — no `/etc/hosts` modification needed. Each URL has its own origin, meaning separate cookies, localStorage, and sessionStorage per environment.

## Dashboard UI

### Home Screen — Project List

Projects are displayed as grouped cards. Each project shows its environments with status, branch name, and tunnel URLs.

```
┌─ my-saas ──────────────────────────────────┐
│  main         ● running   abc.localhost     │
│  feature-auth ● running   def.localhost     │
│  fix-billing  ○ stopped                     │
│                             [+ New Branch]  │
└─────────────────────────────────────────────┘

┌─ client-project ───────────────────────────┐
│  main         ● running   ghi.localhost     │
│                             [+ New Branch]  │
└─────────────────────────────────────────────┘

                          [+ New Project]
```

### Environment Detail View

Clicking into an environment shows:

- **Status** — running/stopped with start/stop controls
- **Tunnel URLs** — clickable links for each exposed port
- **Git diff** — branch changes vs base branch, file-by-file with syntax highlighting
- **Logs** — streaming container output
- **Env vars** — viewer/editor for environment variables
- **Terminal** — optional embedded terminal for quick access

## Environment Variable Management

### Import

On environment creation from a local repo, the tool scans the entire project directory for `.env` files and copies them into the environment config at the same relative paths:

```
apps/web/.env       → copied to container at apps/web/.env
apps/server/.env    → copied to container at apps/server/.env
packages/api/.env   → copied to container at packages/api/.env
```

### Inheritance

When branching an environment, all env var files are copied from the source environment to the new one.

### Manual Management

Environment variables can be viewed and edited through the dashboard UI or CLI:

```
devenv env set my-saas--main MY_SECRET=xyz
devenv env list my-saas--main
```

## Storage

SQLite database (via `bun:sqlite`) stores:

- **Projects** — name, repo URL/path, creation date
- **Environments** — project reference, branch name, status, container ID, devcontainer config
- **Environment variables** — environment reference, file path, key-value pairs (encrypted at rest in future iteration)
- **Port mappings** — environment reference, container port, tunnel hostname

## CLI Commands (MVP)

| Command | Description |
|---|---|
| `devenv create --repo <path\|url> [--branch <name>]` | Create a new environment |
| `devenv branch <env> <new-branch>` | Branch an environment (inherits env vars) |
| `devenv start <env>` | Start an environment |
| `devenv stop <env>` | Stop an environment |
| `devenv list` | List all projects and environments |
| `devenv shell <env>` | Open a terminal into the container |
| `devenv env set <env> <KEY=VALUE>` | Set an environment variable |
| `devenv env list <env>` | List environment variables |
| `devenv dashboard` | Open the web dashboard |

## MVP Scope

### Build First

- `devenv create --repo <local-path>` with branch support
- `devenv start` / `devenv stop`
- `devenv branch` with env var inheritance
- `devenv list` and `devenv shell`
- Auto-scan and copy `.env` files from local repos
- Dev Containers spec support for runtime configuration
- Docker Engine API integration (create, start, stop containers with volume mounts)
- Caddy reverse proxy with deterministic `.localhost` URLs (single port per environment)
- SQLite storage for project/environment/env var config
- Local API server for dashboard communication
- Dashboard: project-grouped environment list, start/stop, tunnel URLs

### Build Later

- `devenv create --repo <remote-url>` (clone from GitHub/GitLab/Azure DevOps)
- Multi-port support per environment (frontend + backend URLs)
- Git diff viewer in dashboard
- Streaming logs in dashboard
- Env var editor in dashboard
- Embedded terminal in dashboard
- Auto-detect listening ports inside containers
- Encrypted env var storage in SQLite
- `bun build --compile` for single-binary distribution
- Docker Sandboxes as optional container backend (microVM isolation)

## Prerequisites

- Docker Desktop (or compatible Docker engine) installed and running
- Bun runtime installed
