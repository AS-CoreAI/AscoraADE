# Ascora ADE — Agentic Development Environment

Desktop agentic development environment (in the spirit of Kiro / Cursor / Windsurf)
that runs against **local LLMs via the LM Studio API**. You open a project, describe a
task in plain language, and an AI agent analyses the code, plans, edits files, runs
commands, and shows a diff before applying changes.

> **Status:** Milestone 1 (runnable skeleton) + LM Studio integration done. The
> shell, panels, file tree, editor, persistence, and a real streaming chat against
> a local LM Studio model are wired. The agent tool-loop, terminal PTY, and Git
> integration land in later milestones.

## LLM & AI Integrations

The environment supports multiple AI providers to power the agentic loop. The
active backend is pinned per task (see the changelog for 1.2 per-task model
pinning):

- **LM Studio** (default): local LLM over the OpenAI-compatible API.
- **OpenRouter**: cloud OpenAI-compatible backend with a saved API key.
- **Codex CLI**: OpenAI Codex agent driven over `stream-json`.
- **GitHub Copilot CLI**: Copilot agent with device-code login and reasoning levels.
- **Claude Code**: Anthropic's CLI agent with selectable permission modes.
- **Google Gemini CLI**: the `gemini` CLI agent (`gemini -p --output-format
  stream-json`) with `--approval-mode` (`plan` / `default` / `auto_edit` / `yolo`)
  and an optional `--model`; reuses the normalized Codex event pipeline so every
  CLI backend shares one renderer code path.
- **GLM / ZCode CLI**: the ZCode agent with `plan` / `yolo` modes.
- **Ascora WProvider**: signed-in web chats (Qwen, DeepSeek, Alice, Mistral,
  Claude, Grok, Gemini, and ChatGPT) driven through a hidden browser without an
  API key.

## Blueprints

Blueprints are project-independent automation scenarios shown between Projects
and SSH in the left rail and as a dockable activity in the IDE. A Blueprint can:

- coordinate several named WProvider agents with separate roles, services, and
  conversation sessions;
- pass every completed result to the next participant in an ordered pipeline;
- run manually or at a bounded minute interval while Ascora ADE is open;
- repeat actions and combine agent prompts with delays, Telegram messages, and
  HTTP webhooks;
- optionally run every agent, or selected agent steps, in a bounded multi-turn
  tool mode. Web tools work project-independently; binding a local project also
  enables file, search, edit, write, and shell tools for manual and scheduled runs;
- configure execution visually on a draggable node canvas: Start/action wires
  define dependencies with fan-out and fan-in; selecting a wire adds an `always`,
  `otherwise`, success/failure, contains, or equality condition. Every matching
  route runs, so one result can trigger several agents, Telegram messages, or
  webhooks. A dedicated Repeat input supports one bounded conditional feedback
  loop with 2–20 passes. The same collapsible route editor is available on every
  card in both Graph and List modes; pan and zoom remain available on the canvas;
- interpolate `{{input}}`, `{{last}}`, `{{now}}`, `{{steps.ID}}`, and
  `{{agents.ID}}`, with live per-step status and output in the execution log.

WProvider owns one shared browser driver, so agent turns are deliberately queued
and executed one at a time even when several Blueprint runs are active. This
keeps provider navigation and captured replies isolated and predictable.

For reliable agent routing, ask the deciding agent to return an exact marker such
as `RESULT=PASS` or `RESULT=FAIL`, then compare that marker on its outgoing wires.
Semantic output conditions are separate from a technical step failure.

The OpenAI-compatible client lives in the **main process** (`src/main/llm/client.ts`)
and is exposed to the renderer over IPC:

- Base URL (default `http://localhost:1234/v1`) + default model, persisted in settings
- `GET /v1/models` — populates the model picker and the connection indicator
- `POST /v1/chat/completions` with `stream: true` — SSE streaming delivered to the
  renderer token-by-token via `llm:chunk` events
- Cancellation via `AbortController` (the composer's Stop button)
- Connection / HTTP / parse failures are normalised to friendly messages and shown
  in the status bar; click it to open the connection settings (Base URL + model + Test)

### File attachments

The composer can attach files and images to a prompt: `dialog:openFiles` opens a
multi-select picker and `fs:importFiles` copies the selection into the workspace
(de-duplicating names), returning the workspace-relative paths the agent can
reference. Backends that accept file context receive the imported paths alongside
the message.

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

## Branches & versioning

Active development happens on **`version1.2`**. The short-lived `release` branch was
a linear continuation of `version1.2` that carried the Gemini CLI backend and
file-attachment work; it has been folded back into `version1.2` (and `main`) and
removed, so there is a single 1.2 line again. Cut future releases as tags off the
`version1.2` / `main` line rather than a standing `release` branch.
