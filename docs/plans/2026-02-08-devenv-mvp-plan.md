# devenv MVP Implementation Plan

**Goal:** Build a CLI tool (`devenv`) that creates isolated Docker-based development environments with per-project+branch containers, automatic `.env` file management, and deterministic `.localhost` URLs via Caddy reverse proxy.

**Architecture:** Bun CLI communicates with Docker Engine via REST API over Unix socket. SQLite (`bun:sqlite`) stores project/environment metadata. Caddy runs as a Docker container providing `*.localhost` reverse proxy routes managed via its admin API. A local HTTP API server exposes data for the React+Vite dashboard SPA.

**Tech Stack:** Bun (runtime + test runner + SQLite), TypeScript (strict, NodeNext), Docker Engine API, Caddy, React 19 + Vite + TanStack Query v5, Turborepo monorepo, Biome (tabs)

---

## Prerequisites & Assumptions

- Docker Desktop installed and running (`/var/run/docker.sock` available)
- Bun installed globally
- Existing monorepo at `/Users/casperleerink/Desktop/code/developer-environments/` with Turborepo, Biome, and `packages/typescript-config`
- Testing: `bun test` (built-in, Vitest-compatible API)

---

## Task 1: Create the `shared` package with types and constants

**Files to create:**
- `packages/shared/package.json` — workspace package, `"exports": { ".": "./src/index.ts" }`, devDeps: `@repo/typescript-config`, `typescript`
- `packages/shared/tsconfig.json` — extends `@repo/typescript-config/base.json`, outDir `dist`
- `packages/shared/src/types.ts`
- `packages/shared/src/constants.ts`
- `packages/shared/src/index.ts` — re-exports types and constants

**Types** (`types.ts`):
- `ProjectStatus`: `"active" | "archived"`
- `EnvironmentStatus`: `"created" | "running" | "stopped" | "error"`
- `Project`: `{ id, name, repoPath, status, createdAt, updatedAt }`
- `Environment`: `{ id, projectId, name, branch, status, containerId, worktreePath, devcontainerConfig, createdAt, updatedAt }`
- `EnvFile`: `{ id, environmentId, relativePath, content }`
- `PortMapping`: `{ id, environmentId, containerPort, hostPort, hostname }`
- `EnvironmentWithProject`: Environment + `project: Project`
- `ProjectWithEnvironments`: Project + `environments: Environment[]`

**Constants** (`constants.ts`):
- `DOCKER_SOCKET` = `"/var/run/docker.sock"`
- `DOCKER_API_VERSION` = `"v1.47"`
- `CADDY_ADMIN_URL` = `"http://localhost:2019"`
- `CADDY_CONTAINER_NAME` = `"devenv-caddy"`
- `CADDY_IMAGE` = `"caddy:alpine"`
- `DASHBOARD_PORT` = `9000`, `API_PORT` = `9001`
- `DEVENV_DIR` = `".devenv"`, `DEVENV_WORKTREES_DIR` = `"worktrees"`, `DEVENV_DB_FILE` = `"devenv.db"`
- `DEFAULT_CONTAINER_PORT` = `3000`, `LOCALHOST_SUFFIX` = `".localhost"`
- `HOST_PORT_RANGE_START` = `49200` — starting port for dynamic host port allocation
- `CONTAINER_LABEL_PREFIX` = `"devenv"`, `CONTAINER_WORKSPACE_DIR` = `"/workspace"`
- `CADDY_HOST_GATEWAY` = `"host.docker.internal"` — Docker Desktop DNS name for reaching host from inside containers

**Verify:** `bun install`, `bun run check-types` in `packages/shared`

**Commit:** `feat: add shared package with types and constants`

---

## Task 2: Create the CLI package scaffold with entry point and command router

**Files to create:**
- `packages/cli/package.json` — workspace package with `"bin": { "devenv": "./src/index.ts" }`, deps: `@repo/shared`, devDeps: `@repo/typescript-config`, `@types/bun`, `typescript`
- `packages/cli/tsconfig.json` — extends base, `"types": ["bun"]`
- `packages/cli/src/commands/index.ts` — command registry pattern: `registerCommand({ name, description, run })`, `getCommand(name)`, `getAllCommands()`
- `packages/cli/src/index.ts` — shebang `#!/usr/bin/env bun`, parses `process.argv`, dispatches to registered command or prints help. Command imports are commented out initially, uncommented as each command is built.

**Verify:** `bun run src/index.ts --help` prints help text, `bun run check-types`

**Commit:** `feat: scaffold CLI package with command router`

---

## Task 3: SQLite database layer

**Files to create:**
- `packages/cli/src/db/database.ts`
- `packages/cli/src/db/__tests__/database.test.ts`

**Database** (`database.ts`):
- Uses `bun:sqlite` (`import { Database } from "bun:sqlite"`)
- `createDatabase(dbPath?)`: Opens/creates SQLite DB at `~/.devenv/devenv.db` (default). Runs `db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")`. Creates tables via `CREATE TABLE IF NOT EXISTS`:
  - `projects` (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, repo_path TEXT NOT NULL, status TEXT DEFAULT 'active', created_at/updated_at TEXT DEFAULT CURRENT_TIMESTAMP)
  - `environments` (id, project_id FK, name TEXT UNIQUE, branch, status DEFAULT 'created', container_id, worktree_path, devcontainer_config, timestamps)
  - `env_files` (id, environment_id FK, relative_path, content, UNIQUE(environment_id, relative_path))
  - `port_mappings` (id, environment_id FK, container_port INTEGER, host_port INTEGER UNIQUE, hostname TEXT UNIQUE)
- CRUD functions using prepared statements (`db.prepare().run()` / `.get()` / `.all()`):
  - `insertProject`, `getProjectByName`, `getProjectsWithEnvironments` (JOIN + group)
  - `insertEnvironment`, `getEnvironmentByName`, `getEnvironmentsByProject`, `updateEnvironmentStatus`, `updateEnvironmentContainer`
  - `upsertEnvFile`, `getEnvFiles`
  - `insertPortMapping`, `getPortMappings`, `getNextAvailableHostPort` (queries max host_port, returns max+1 or `HOST_PORT_RANGE_START`)
- All functions take `db: Database` as first param (caller manages lifecycle)
- Map snake_case DB columns to camelCase TypeScript types from `@repo/shared`

**Tests** (`database.test.ts`):
- Use in-memory DB (`:memory:`) for speed
- Test: insert project → retrieve by name, insert environment → update status, upsert env files, port mapping uniqueness constraint, `getNextAvailableHostPort` returns sequential ports

**Verify:** `bun test src/db/`

**Commit:** `feat: add SQLite database layer with CRUD operations`

---

## Task 4: Docker Engine API client

**Files to create:**
- `packages/cli/src/docker/client.ts`
- `packages/cli/src/docker/__tests__/client.test.ts`

**Docker client** (`client.ts`):
- All requests via `fetch()` to `http://localhost/${DOCKER_API_VERSION}/...` with `{ unix: DOCKER_SOCKET }` option (Bun's Unix socket fetch extension)
- Helper `dockerFetch(path, options?)`: wraps fetch, checks `res.ok`, throws on error with parsed JSON error message
- Functions:
  - `createContainer(name, image, workspaceDir, envVars, labels, portBindings)`: POST `/containers/create?name=...` with body `{ Image, Env, Labels, ExposedPorts: { "3000/tcp": {} }, HostConfig: { Binds, PortBindings: { "3000/tcp": [{ HostPort: "49200" }] } }, WorkingDir }`. Uses bridge networking (Docker default) so each container gets its own network namespace — multiple containers can internally listen on the same port without conflicts.
  - `startContainer(containerId)`: POST `/containers/${id}/start`
  - `stopContainer(containerId)`: POST `/containers/${id}/stop`
  - `removeContainer(containerId)`: DELETE `/containers/${id}?force=true`
  - `inspectContainer(containerId)`: GET `/containers/${id}/json`
  - `pullImage(image)`: POST `/images/create?fromImage=...&tag=...` — read body stream to completion
  - `listContainers(labelFilter?)`: GET `/containers/json?filters=...` with label filter for devenv containers
  - `execInContainer(containerId, cmd)`: POST `/containers/${id}/exec` with `{ Cmd, AttachStdin/out/err, Tty }`, then POST `/exec/${execId}/start` — returns exec ID for interactive shell

**Tests** (`client.test.ts`):
- Test `dockerFetch` URL construction, error handling
- Mock fetch to verify request bodies/methods (don't require running Docker)

**Verify:** `bun test src/docker/`

**Commit:** `feat: add Docker Engine API client via Unix socket`

---

## Task 5: Caddy tunnel manager

**Files to create:**
- `packages/cli/src/tunnel/caddy.ts`
- `packages/cli/src/tunnel/__tests__/caddy.test.ts`

**Caddy manager** (`caddy.ts`):
- `ensureCaddyRunning()`: Check if `devenv-caddy` container exists via `inspectContainer`. If not, check that port 80 is available (attempt `Bun.listen({ port: 80 })`, close immediately — if it throws, exit with a clear error: "Port 80 is in use. Caddy needs port 80 for .localhost routing."). Then pull `caddy:alpine` and create/start container with bridge networking (Docker default) and published ports `80:80` and `2019:2019`, plus a volume mount for Caddy data. `--network host` is not used because it doesn't work on Docker Desktop for macOS. If container exists but stopped, start it.
- `addRoute(routeId, hostname, hostPort)`: POST to `${CADDY_ADMIN_URL}/config/apps/http/servers/devenv/routes` with a route object: `{ "@id": routeId, match: [{ host: [hostname] }], handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "${CADDY_HOST_GATEWAY}:${hostPort}" }] }] }`. Uses Caddy's `/id/` API for upserts. Note: `hostPort` is the Docker-published port on the host. Caddy reaches it via `host.docker.internal` since Caddy itself runs inside a Docker container and needs the host gateway to access host-published ports.
- `removeRoute(routeId)`: DELETE `${CADDY_ADMIN_URL}/id/${routeId}`
- `listRoutes()`: GET `${CADDY_ADMIN_URL}/config/apps/http/servers/devenv/routes`
- On first route add, initialize Caddy server config if empty: PUT to `/config/apps/http/servers/devenv` with `{ listen: [":80"], routes: [] }`

**Tests**: Mock fetch, verify Caddy admin API request shapes

**Verify:** `bun test src/tunnel/`

**Commit:** `feat: add Caddy reverse proxy tunnel manager`

---

## Task 6: Git worktree and env file utilities

**Files to create:**
- `packages/cli/src/utils/git.ts`
- `packages/cli/src/utils/envfiles.ts`
- `packages/cli/src/utils/__tests__/envfiles.test.ts`

**Git utilities** (`git.ts`):
- `createWorktree(repoPath, branch, worktreePath)`: Runs `git -C ${repoPath} worktree add ${worktreePath} ${branch}` via `Bun.spawn`
- `removeWorktree(repoPath, worktreePath)`: Runs `git -C ${repoPath} worktree remove ${worktreePath} --force`
- `listBranches(repoPath)`: Runs `git -C ${repoPath} branch --format='%(refname:short)'`, parses output

**Env file utilities** (`envfiles.ts`):
- `discoverEnvFiles(dirPath)`: Walks directory (max depth 2, excludes `node_modules`, `.git`, `dist`, `.devenv`, `worktrees`), finds all `.env*` files (`.env`, `.env.local`, `.env.development`, etc.), returns `{ relativePath, content }[]`
- `formatRouteId(envName)`: Returns `devenv-${envName}` for Caddy route IDs
- `generateHostname(projectName, branch, port?)`: Returns `${projectName}-${branch}${port !== DEFAULT_CONTAINER_PORT ? "-" + port : ""}.localhost`

**Tests**: Test env file discovery (create temp dir with test files), hostname generation edge cases

**Verify:** `bun test src/utils/`

**Commit:** `feat: add git worktree and env file utilities`

---

## Task 7: Dev Container configuration parser

**Files to create:**
- `packages/cli/src/devcontainer/parser.ts`
- `packages/cli/src/devcontainer/__tests__/parser.test.ts`

**Parser** (`parser.ts`):
- `findDevcontainerConfig(projectPath)`: Look for `.devcontainer/devcontainer.json` or `.devcontainer.json` in project root, return parsed JSON or null
- `resolveImage(config)`: Extract `image` field from devcontainer.json. If not present, fall back to `"node:20"` as default.
- `resolveForwardPorts(config)`: Extract `forwardPorts` array, default to `[DEFAULT_CONTAINER_PORT]`
- `resolveEnvVars(config)`: Extract `containerEnv` and `remoteEnv` maps, merge them
- `resolvePostCreateCommand(config)`: Extract `postCreateCommand` string/array

**Known limitation:** Only the `image` field is supported. `build.dockerfile` / `build.context` configs are not handled — the parser falls back to `node:20` in those cases. This covers the common case for MVP.

**Tests**: Parse sample devcontainer.json objects, test fallback defaults, test missing file case

**Verify:** `bun test src/devcontainer/`

**Commit:** `feat: add devcontainer.json parser`

---

## Task 8: `devenv create` command

**Files to create/modify:**
- Create: `packages/cli/src/commands/create.ts`
- Modify: `packages/cli/src/index.ts` — uncomment create import

**Behavior:**
- Parses `--repo <path>` (required) and `--branch <name>` (optional, defaults to current branch) flags
- Validates repo path exists and is a git repo
- Creates `.devenv/` directory in repo root if needed
- Inserts project into DB (or retrieves existing)
- Creates git worktree at `.devenv/worktrees/<branch>/`
- Discovers `.env*` files from repo root and stores in DB
- Parses `devcontainer.json` if present, otherwise uses defaults
- Pulls Docker image, creates container with:
  - Bind mount: worktree path → `/workspace`
  - Bridge networking (Docker default) — each container gets its own network namespace
  - Port bindings: for each forwarded port, allocates a unique host port via `getNextAvailableHostPort()` and maps it (e.g., container :3000 → host :49200)
  - Env vars from devcontainer config + discovered env files
  - Labels: `devenv.project=<name>`, `devenv.environment=<env-name>`
- Saves container ID and environment to DB
- Creates port mappings (with host ports) in DB and registers Caddy routes pointing to the host ports
- Starts the container
- Prints summary: environment name, status, `.localhost` URLs

**Known limitation:** No rollback on partial failure. If the command fails mid-way (e.g., image pulls but container creation fails), already-completed steps (worktree, DB records) are not cleaned up. The user must manually remove artifacts or re-run. Acceptable for MVP.

**Environment naming convention:** `<project-name>-<branch>` (slugified)

**Verify:** `bun run check-types`

**Commit:** `feat: add devenv create command`

---

## Task 9: `devenv start` and `devenv stop` commands

**Files to create/modify:**
- Create: `packages/cli/src/commands/start.ts`
- Create: `packages/cli/src/commands/stop.ts`
- Modify: `packages/cli/src/index.ts` — uncomment imports

**`devenv start <env-name>`:**
- Look up environment by name in DB
- Start container via Docker API
- Update status to `"running"` in DB
- Ensure Caddy is running, re-register all port mapping routes
- Print confirmation with `.localhost` URLs

**`devenv stop <env-name>`:**
- Look up environment by name in DB
- Stop container via Docker API
- Update status to `"stopped"` in DB
- Remove Caddy routes for this environment
- Print confirmation

**Verify:** `bun run check-types`

**Commit:** `feat: add devenv start and stop commands`

---

## Task 10: `devenv list` command

**Files to create/modify:**
- Create: `packages/cli/src/commands/list.ts`
- Modify: `packages/cli/src/index.ts` — uncomment import

**Behavior:**
- Fetches all projects with their environments from DB via `getProjectsWithEnvironments`
- Prints formatted table: project name, environment name, branch, status, `.localhost` URLs
- Use colored status indicators: green `●` for running, grey `○` for stopped
- Handle empty state: print "No environments found" message

**Verify:** `bun run check-types`

**Commit:** `feat: add devenv list command`

---

## Task 11: `devenv shell` command

**Files to create/modify:**
- Create: `packages/cli/src/commands/shell.ts`
- Modify: `packages/cli/src/index.ts` — uncomment import

**Behavior:**
- Takes `<env-name>` argument
- Look up environment in DB, verify status is `"running"`
- Use `execInContainer` from the Docker client (Task 4) to create an exec instance with `{ Cmd: ["/bin/sh"], AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true }`
- Start the exec instance via POST `/exec/${execId}/start` with `{ Detach: false, Tty: true }` — this upgrades to a raw stream
- Wire the response body stream to `process.stdout` and `process.stdin` to the request body for interactive I/O
- Set terminal to raw mode (`process.stdin.setRawMode(true)`) for proper TTY passthrough, restore on exit
- Wait for the stream to close (shell exited)

**Verify:** `bun run check-types`

**Commit:** `feat: add devenv shell command`

---

## Task 12: `devenv branch` command

**Files to create/modify:**
- Create: `packages/cli/src/commands/branch.ts`
- Modify: `packages/cli/src/index.ts` — uncomment import

**Behavior:**
- Takes `<env-name> <new-branch>` arguments
- Look up source environment in DB
- Create new git worktree for the new branch
- Discover env files from new worktree
- Copy env file records from source environment to new environment in DB
- Create new container (same image/config as source, but mounting new worktree, with fresh host port allocations via `getNextAvailableHostPort()`)
- Create port mappings with new host ports and new hostnames, register Caddy routes
- Start the new container
- Print summary with new environment name and URLs

**Verify:** `bun run check-types`

**Commit:** `feat: add devenv branch command for cloning environments`

---

## Task 13: `devenv env` command

**Files to create/modify:**
- Create: `packages/cli/src/commands/env.ts`
- Modify: `packages/cli/src/index.ts` — uncomment import

**Subcommands:**
- `devenv env list <env-name>`: Fetch environment from DB, print all stored env files with their contents, grouped by relative path
- `devenv env set <env-name> <KEY=VALUE>`: Parse KEY=VALUE, find or create `.env` file record in DB, append or update the key. Uses `upsertEnvFile` from the database layer.

**Verify:** `bun run check-types`

**Commit:** `feat: add devenv env command for managing environment variables`

---

## Task 14: Local API server for dashboard

**Files to create/modify:**
- Create: `packages/cli/src/api/server.ts`
- Create: `packages/cli/src/commands/dashboard.ts`
- Modify: `packages/cli/src/index.ts` — uncomment dashboard import

**API server** (`server.ts`):
- Uses `Bun.serve()` on `API_PORT` (9001)
- CORS headers on all responses (`Access-Control-Allow-Origin: *`)
- Endpoints:
  - `GET /api/projects` — returns projects with environments and port mappings (JOIN query)
  - `GET /api/environments/:name` — returns single environment with env files and port mappings
  - `POST /api/environments/:name/start` — starts container, updates DB status, registers Caddy routes
  - `POST /api/environments/:name/stop` — stops container, updates DB status, removes Caddy routes
- Error handling: catch errors, return `{ error: message }` with 500 status

**Dashboard command** (`dashboard.ts`):
- Calls `startApiServer()`, prints URL, keeps process alive with `await new Promise(() => {})`

**Verify:** `bun run check-types`

**Commit:** `feat: add local API server and dashboard command`

---

## Task 15: Dashboard — React + Vite SPA scaffold

**Files to create:**
- `packages/dashboard/package.json`
- `packages/dashboard/tsconfig.json`
- `packages/dashboard/vite.config.ts`
- `packages/dashboard/index.html`
- `packages/dashboard/src/main.tsx`
- `packages/dashboard/src/api/client.ts`
- `packages/dashboard/src/App.tsx`

**Package setup:**
- Dependencies: `@repo/shared`, `@tanstack/react-query` (v5), `react`, `react-dom` (v19)
- DevDependencies: `@repo/typescript-config`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `typescript`, `vite`
- Vite dev server on port 9000
- tsconfig extends `@repo/typescript-config/react-library.json` (provides `jsx: react-jsx` on top of `base.json`)

**API client** (`api/client.ts`):
- `API_BASE` = `http://localhost:${API_PORT}`
- Response types: `ProjectResponse` (with nested `EnvironmentResponse[]` each with `PortMappingResponse[]`)
- `fetchProjects(): Promise<ProjectResponse[]>` — GET `/api/projects`
- `startEnvironment(envName: string): Promise<void>` — POST `/api/environments/:name/start`
- `stopEnvironment(envName: string): Promise<void>` — POST `/api/environments/:name/stop`

**Entry point** (`main.tsx`):
- Create `QueryClient`, wrap app in `<QueryClientProvider>` and `<StrictMode>`

**App component** (`App.tsx`):
- Uses **TanStack Query** — no `useEffect` or `useState` for data fetching
- `useQuery({ queryKey: ["projects"], queryFn: fetchProjects, refetchInterval: 5000 })` for automatic polling
- `useMutation({ mutationFn: startEnvironment, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }) })` for start action
- `useMutation({ mutationFn: stopEnvironment, onSuccess: ... })` for stop action
- Renders project cards with environment rows showing: status indicator (● running / ○ stopped), branch name, status text, `.localhost` links, Start/Stop button
- Buttons show pending state (`"Starting..."` / `"Stopping..."`) and are disabled during mutations
- Error states: query error (API not running message), mutation errors (inline)
- Empty state: "No projects yet" with create command hint
- Minimal inline styles, dark theme (`background: #0a0a0a`, `color: #e5e5e5`)

**Verify:** `bun install`, `bun run check-types`, `bun run dev` starts on port 9000

**Commit:** `feat: add React dashboard SPA with project/environment list`

---

## Task 16: Update turbo.json and root config for new packages

**Files to modify:**
- `turbo.json` — change build outputs from `.next/**` to `dist/**`, add `"test"` task (`{ "dependsOn": ["^build"], "cache": false }`)
- `package.json` (root) — add `"test": "turbo run test"` to scripts

**Verify:** `bun run check-types` (all packages), `cd packages/cli && bun test` (all unit tests pass)

**Commit:** `chore: update turbo config and root scripts for new packages`

---

## Task 17: End-to-end manual test and polish

**Goal:** Verify the full workflow works end to end.

1. `devenv --help` — lists all commands
2. `devenv create --repo <test-repo> --branch main` — creates environment, container, Caddy route
3. `devenv list` — shows project with environment
4. `devenv start <env-name>` — container starts, status running
5. `devenv shell <env-name>` — opens interactive shell (`exit` to leave)
6. `devenv stop <env-name>` — container stops, route removed
7. `devenv branch <env-name> feature-test` — new environment with inherited env vars
8. `devenv dashboard` (background) + `curl http://localhost:9001/api/projects | jq` — JSON response
9. Fix any issues found

**Commit:** `fix: address issues found during end-to-end testing`

---

## Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | `packages/shared` | Types & constants |
| 2 | `packages/cli` | CLI scaffold with command router |
| 3 | `packages/cli/src/db` | SQLite database layer |
| 4 | `packages/cli/src/docker` | Docker Engine API client |
| 5 | `packages/cli/src/tunnel` | Caddy tunnel manager |
| 6 | `packages/cli/src/utils` | Git worktree & env file utils |
| 7 | `packages/cli/src/devcontainer` | Dev Container config parser |
| 8 | `packages/cli/src/commands/create` | `devenv create` command |
| 9 | `packages/cli/src/commands/start,stop` | `devenv start/stop` commands |
| 10 | `packages/cli/src/commands/list` | `devenv list` command |
| 11 | `packages/cli/src/commands/shell` | `devenv shell` command |
| 12 | `packages/cli/src/commands/branch` | `devenv branch` command |
| 13 | `packages/cli/src/commands/env` | `devenv env` command |
| 14 | `packages/cli/src/api` | Local API server |
| 15 | `packages/dashboard` | React + Vite dashboard SPA (TanStack Query) |
| 16 | Root config | Turbo/root updates |
| 17 | E2E test | Manual integration testing |

**Dependencies:** Tasks 1–2 first (foundation), then 3–7 in parallel (core modules), then 8–14 sequentially (commands depend on modules), then 15–17 (dashboard and polish).
