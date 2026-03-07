# TechTonic App

React 19 + Vite drawing app with WebGL2 engine, cyberpunk/Pip-Boy aesthetic, Capacitor Android build, and Solana wallet integration.

## Package Manager
Use **bun** (not npm/yarn/pnpm) for all install, run, and build commands.

## Styling
Use **Tailwind CSS** for all styling. Exceptions:
- `src/engine/` — hand-written CSS only (no Tailwind)
- Complex visual effect classes (scanlines, glitch animations, CRT glow) — plain CSS is fine

## Read-Only
`original-browser-reference/` is a **read-only reference**. Never modify, delete, or move files in this directory.

## Engine Constraints
Everything in `src/engine/` must be:
- **Zero external dependencies** — no React, no npm packages, no framework imports
- **Easily compilable into a standalone HTML page** — vanilla JS/TS, plain CSS, raw GLSL only
- Canvas is fixed **1080x1920**, WebGL2 with bottom-left origin (Y-axis inverted from DOM)
- All parameters derived deterministically from a seed — no manual config

## Engine ↔ React Boundary
- React talks to the engine via the `Engine` interface from `src/engine/renderer.ts`
- Engine UI (`src/engine/ui/`) uses raw HTML + vanilla JS injected via `?raw` imports — not React components
- Engine must be cleaned up: call `engine.destroy()` in `useEffect` return

## Fonts
Self-hosted via **Fontsource** (no Google Fonts CDN). CSS vars defined in `src/index.css`:
- **Display/headings**: `var(--font-display)` → Rajdhani (weights 300–700)
- **Mono/UI text**: `var(--font-mono)` → Share Tech Mono
- `src/engine/ui/` — stays on `'Courier New', monospace` (zero-dependency rule)

## Icons
Use **Phosphor Icons** (`@phosphor-icons/react`) for all icons in React components. Exception:
- `src/engine/ui/` — continues using Unicode symbols (zero-dependency rule)

## Project Conventions
- Pages use barrel exports (`src/pages/canvas/index.ts` re-exports `CanvasPage`)
- CSS co-located with components; engine CSS lives in `src/engine/ui/`
- Shared UI components in `src/components/ui/` (e.g., `MenuButton`)
- `cn()` utility from `src/utils/ui-helpers.ts` for class merging (clsx + tailwind-merge)
- Env vars must use `VITE_` prefix; centralized in `src/config/env.ts`
- GLSL shaders imported as strings via `vite-plugin-glsl`

## Monorepo Structure
Two independent deployables with separate dependency trees:
- **Frontend** (`src/`, root `package.json`) — React 19 + Vite → Vercel. Capacitor Android build also uses this.
- **Backend** (`server/`, own `package.json`) — Bun + Hono API → Railway. See `server/CLAUDE.md` for backend-specific rules.

Do not import across boundaries (`server/` ↔ `src/`). Do not install deps in the wrong `package.json`.

## Agent Directives
- When a task has multiple viable approaches, present 2-3 solution options with brief pros/cons before implementing. For simple, obvious fixes, proceed directly.
- Ask clarifying questions for user and wait for answers before starting work if the request is ambiguous or if a solution has meaningful tradeoffs.
- Ask and wait for explicit confirmation from user before: deleting files or large code blocks, rewriting or refactoring more than ~50 lines, or creating new files that change project structure.
- Ask and wait for explicit confirmation from user before any git operations (commit, push, merge, rebase, branch deletion, etc.).
