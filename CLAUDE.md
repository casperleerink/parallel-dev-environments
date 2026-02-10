# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## TypeScript Standards

- **Strict mode is enforced** (`noUncheckedIndexedAccess: true`, `strict: true`). Never use `any` or `as unknown as ...` type assertions. Apply strict type safety throughout.
- After making code changes, always run type checking, linting, and tests.

## Commands

```bash
# All commands use Turborepo from root
bun run check-types        # Type check all packages
bun run check              # Biome lint + format check (all packages at once)
bun run check:fix           # Auto-fix lint + format issues
bun run test               # Run all tests

# Single test file (bun test runner, run from packages/cli/)
bun test packages/cli/src/db/__tests__/database.test.ts

# Package-specific
bun run --filter @repo/cli check-types
bun run --filter @repo/dashboard dev    # Vite dev server on :9000
```

## Architecture

**Monorepo** managed by Turborepo + Bun workspaces.

### Packages

- **`packages/cli`** — Bun CLI tool (`devenv` command). Orchestrates Docker containers, git worktrees, Caddy routing, and dev container setup. This is where most development happens.
- **`packages/shared`** — Constants (`constants.ts`) and TypeScript types (`types.ts`) shared across packages. All Docker/Caddy config values, port ranges, and domain types live here.
- **`packages/dashboard`** — React 19 SPA (Vite) with TanStack Query for managing environments via the API.
- **`packages/ui`** — Stub component library (button, card, code).
- **`packages/typescript-config`** — Shared `tsconfig` base configs.

### CLI Internal Architecture (`packages/cli/src/`)

**Command pattern**: Each command is a file in `commands/` registered via `registerCommand()` in `commands/index.ts`.

**Key modules**:
- `db/database.ts` — SQLite (via `bun:sqlite`) with WAL mode. Schema: projects, environments, env_files, port_mappings. Uses prepared statements with typed row mappers.
- `docker/client.ts` — Direct Docker Engine REST API calls via `Bun.fetch` with unix socket (not a Docker SDK). API version v1.47.
- `tunnel/caddy.ts` — Manages Caddy reverse proxy container for `.localhost` routing. JSON config via admin API (PUT/POST to `:2019`).
- `devcontainer/` — Parses `devcontainer.json`, detects project features (bun/node/turbo), spawns `devcontainer` CLI subprocess.
- `utils/git.ts` — Git worktree creation/removal and branch listing.
- `utils/envfiles.ts` — Recursive `.env` file discovery (depth limit 2), hostname generation.
- `api/server.ts` — `Bun.serve()` REST API on `:9001` for the dashboard.

### Data Flow

`devenv create` → parse devcontainer.json → create git worktree → create DB records → spawn devcontainer CLI (builds/starts container) → discover ports → register Caddy routes → store port mappings.

### Docker Socket Resolution

Checks `DOCKER_HOST` env var → `~/.docker/run/docker.sock` (macOS Docker Desktop) → `/var/run/docker.sock` (Linux).

## Formatting

- Biome for linting and formatting (indentation: tabs).
- Config at root `biome.json`.

## Testing

- Bun's native test runner (`bun:test`).
- Test files at `src/**/__tests__/*.test.ts`.
- Tests use temporary directories and in-memory databases for isolation.
