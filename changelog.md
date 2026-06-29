## Ascora ADE 1.1.0
What's new?

### Added
- OpenRouter can now be enabled as a cloud OpenAI-compatible backend with a saved local API key, provider picker entry, model refresh, chat streaming, and OpenRouter-specific connection status.
- OpenRouter model selection is persisted with workspace LLM settings and used consistently for agent chat, Git branch naming, Git commit message generation, and usage analytics.
- Agent backend settings are now reachable from the left rail.
- Agent runs can now keep progressing in the background when switching workspaces, tasks, SSH terminals, or starting a new task, then restore their live state when reopened.
- Claude usage now opens an in-app breakdown modal from the status bar with per-window bars, reset times, refresh, and a detailed usage link.
- LM Studio reachability is now probed in the background so provider pickers can reflect whether the local server is available even when another backend is selected.

### Fixed
- OpenRouter API keys pasted as `Authorization:` or `Bearer ...` values are normalized before saving and sending requests.
- OpenRouter falls back to LM Studio when it is disabled or missing an API key, and reports clearer connection/authentication errors.
- OpenRouter model dropdowns keep the selected model and default `openrouter/free` option visible even when the remote model list changes.
- Codex change summaries now fill per-file `+N/-N` line counts in the changes popover when the CLI does not report them directly, using git stats as a fallback.
- Local and SSH terminals now copy selected text with `Ctrl/Cmd+C`; right-click also copies the current selection.
- OpenRouter API key normalization is now shared between main and renderer processes (moved to `@shared/ipc.ts`), with improved parsing for `Authorization: Bearer <key>`, `Bearer <key>`, and quoted keys.
- OpenRouter request header uses correct casing (`Authorization` instead of `authorization`).
- Renderer normalizes and displays the cleaned API key immediately after saving.
- Stopping a task or rejecting Ask-mode approvals now only affects the targeted run instead of any other task that is still running.
- Deleting a running task now stops that run, removes its live snapshot, and prevents a late save from restoring the deleted task.
- Agent runs now keep the provider, model, permission mode, workspace, and SSH context captured at submit time so later UI switches do not change an in-flight task.
- Failed model refreshes now clear stale model lists and update LM Studio availability instead of showing models from a previous backend.

### Changed
- LM Studio is shown in backend pickers only while it is reachable or already selected, and OpenRouter setup controls only appear when OpenRouter is active.
- **Version bumped to 1.1** in the About menu (left rail).

## Ascora ADE 1.0.0 — Initial release 28.06.2026

*First public release of Ascora ADE — an Agentic Development Environment: a desktop IDE with an AI agent inside it. Describe a task in plain language; the agent reads your code, plans, edits files, runs commands, and shows a diff before applying — powered by the models you run yourself.*

### Highlights
- **Agentic edit loop** — read → plan → edit → run → verify, all in one place.
- **Diffs before disk** — every change is shown as a side-by-side diff you approve or reject, or switch to **Auto-apply** to let a task run end to end.
- **Bring your own model** — run fully offline against a local LLM, or delegate to a CLI agent. Nothing is uploaded unless you choose a hosted backend.

### Models — one agent, every backend
Switch provider and model per task; each workspace remembers its own choice.
- **LM Studio** *(default)* — any local model you load, via the OpenAI-compatible HTTP API with SSE streaming. Fully offline.
- **Claude Code** — Claude Opus · Sonnet · Haiku through the local `claude` CLI, with selectable permission mode (e.g. accept-edits).
- **Codex** — OpenAI GPT-5.x through the local `codex` CLI, with sandbox policy and reasoning-effort control.
- **GLM / ZCode** — Zhipu GLM (e.g. glm-4.6) via the bundled ZCode agent, with plan / build / edit / yolo permission modes.

### Features
- **Transparent reasoning** — collapsible thought process, streaming tool cards (output, diffs, exit codes), and a live token + time counter.
- **Monaco editor** — the editor that powers VS Code, bundled and fully offline.
- **Integrated terminal** — run builds and tests without leaving the workspace (xterm.js + PTY).
- **Git, with AI commits** — stage, diff, branch, and push, or let the agent write the commit message.
- **SSH terminals** — drive remote hosts from the same agent loop.
- **Live preview** — built-in server renders your HTML as you change it.
- **Usage analytics** — track tokens, models, and tasks across every workspace.
- **Dockable panels** — a VS Code-style layout you can split, stack, and re-dock.
