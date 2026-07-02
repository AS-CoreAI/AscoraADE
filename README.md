# Ascora ADE — Agentic Development Environment

Desktop agentic development environment (in the spirit of Kiro / Cursor / Windsurf)
that runs against **local LLMs via the LM Studio API**. You open a project, describe a
task in plain language, and an AI agent analyses the code, plans, edits files, runs
commands, and shows a diff before applying changes.

> **Status:** Milestone 1 (runnable skeleton) + LM Studio integration done. The
> shell, panels, file tree, editor, persistence, and a real streaming chat against
> a local LM Studio model are wired. The agent tool-loop, terminal PTY, and Git
> integration land in later milestones.

## LM Studio integration

The OpenAI-compatible client lives in the **main process** (`src/main/llm/client.ts`)
and is exposed to the renderer over IPC:

- Base URL (default `http://localhost:1234/v1`) + default model, persisted in settings
- `GET /v1/models` — populates the model picker and the connection indicator
- `POST /v1/chat/completions` with `stream: true` — SSE streaming delivered to the
  renderer token-by-token via `llm:chunk` events
- Cancellation via `AbortController` (the composer's Stop button)
- Connection / HTTP / parse failures are normalised to friendly messages and shown
  in the status bar; click it to open the connection settings (Base URL + model + Test)

## Stack

- **Electron** + **electron-vite** — desktop shell, secure main ↔ preload ↔ renderer IPC
- **React + TypeScript + Vite** — renderer UI
- **Monaco Editor** — code editor (workers bundled locally, fully offline)
- **xterm.js** — integrated terminal (display-only until the PTY milestone)
- **allotment** — VS Code-style resizable panels
- **zustand** — renderer state
- Persistence behind a `Store` interface (currently an atomic JSON file; see note below)

## Project layout

```
src/
  shared/      IPC channel + payload types (single source of truth)
  main/        Electron main process
    store/     persistence (Store interface)
    ipc/       window / dialog / fs / settings handlers
  preload/     contextBridge — exposes the typed window.ascora API
  renderer/    React app (home launcher + workspace IDE views)
```

## Scripts

```bash
npm run dev         # electron-vite dev (HMR)
npm run build       # bundle main + preload + renderer
npm run preview     # build then launch the packaged-style app
npm run typecheck   # tsc for main and renderer
```

## Environment notes

- **Launching the GUI from a terminal that sets `ELECTRON_RUN_AS_NODE=1`** makes
  Electron run as plain Node (no window, `app` is undefined). Unset it to launch:
  `env -u ELECTRON_RUN_AS_NODE npx electron .`
- **SQLite / persistence:** the spec calls for SQLite. `SqliteStore`
  (`better-sqlite3`) is the primary backend, but it's a native module that needs the
  Visual Studio **"Desktop development with C++"** workload (MSVC + Windows SDK).
  Until that's present, `better-sqlite3` is an `optionalDependency` that silently
  fails to build and the app falls back to an atomic JSON file behind the same
  `Store` interface. To activate SQLite: install the C++ workload, then
  `npm install better-sqlite3` (its `postinstall` rebuilds it for Electron's ABI).
  No code changes needed — the app logs which backend is active on boot.

## Excluded from analysis

`node_modules`, `.git`, `vendor`, `dist`, `build`, `.next`, `venv`, `__pycache__`,
`out`, `.cache` (see `EXCLUDED_DIRS` in `src/shared/ipc.ts`).

## Release / distribution branch note

Local path: E:\\Ascora-ADE

Note: this README entry is intended for the release/distribution branch (not the active development branch). Several integrations are intentionally not included in this release build and should be added or enabled in the main development branch or future releases. Examples of missing integrations: GitHub Copilot integration and Gemini (Gemeni) support.


