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

## Project Conventions
- Pages use barrel exports (`src/pages/canvas/index.ts` re-exports `CanvasPage`)
- CSS co-located with components; engine CSS lives in `src/engine/ui/`
- Shared UI components in `src/components/ui/` (e.g., `MenuButton`)
- `cn()` utility from `src/utils/ui-helpers.ts` for class merging (clsx + tailwind-merge)
- Env vars must use `VITE_` prefix; centralized in `src/config/env.ts`
- GLSL shaders imported as strings via `vite-plugin-glsl`
