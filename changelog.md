## Ascora ADE 1.2.0
What's new?

### Added
- **UI localization (English + Russian)** — the interface is now fully translatable via a central catalog (`src/renderer/src/language`), with a language picker in the left-rail footer next to the theme selector. Hardcoded strings across every renderer component (rail, title bar, composer, chat, connection/usage/SSH/skills modals, editor, explorer, Git, status bar, terminals, home view) are routed through a `tr()` helper. The choice is persisted (`appearance.language`), restored on launch, applied to `<html lang>`, and used for locale-aware date/time formatting.
- **Ollama backend** — Ollama is now a selectable local OpenAI-compatible provider with its own saved base URL (`http://localhost:11434/v1` by default), model refresh, model selection, streaming chat, tool-call loop, status-bar state, usage analytics, and Git AI commit-message support.
- **Google Gemini CLI backend** — the `gemini` CLI is now a selectable agent provider (`gemini -p --output-format stream-json`), with an optional binary path and `--model` override, `--approval-mode` selection (`plan` / `default` / `auto_edit` / `yolo`), a reachability check, and `--resume` session continuation. It reuses the normalized Codex event/item pipeline so every CLI backend shares one renderer code path.
- **File & image attachments in the composer** — attach files/images to a prompt via a multi-select picker (`dialog:openFiles`); the selection is imported into the workspace with duplicate-name de-duplication (`fs:importFiles`) and exposed to the agent as workspace-relative paths.
- **Per-task (per-chat) model/provider pinning** — each chat/task now remembers its own model/provider selection independently of the workspace default. Opening a task restores its pinned model; new chats inherit the workspace default until the user picks a model, then that choice is pinned to that chat.
- Task-specific model/provider is persisted per task (`task.llm` settings) and restored when opening a task, even after switching workspaces or restarting the app.
- New task's model selection is pinned on first user message (first submit), so a brand-new chat gets its own pinned model from the first interaction.
- Deleting a task also removes its pinned model/provider selection from settings.
- Workspace LLM persistence (`persistWorkspaceLlm`) now also pins the current selection to the active task, so each chat keeps its own model.

### Changed
- **Local OpenAI-compatible backend handling** now supports separate LM Studio and Ollama URLs/models so switching providers does not overwrite the other local backend's saved model.
- Provider pickers now keep LM Studio visible but disabled while it is unreachable, with a short availability tooltip, while Ollama remains selectable as another local backend.
- **Simplified workspace model sync** — `syncWorkspaceLlm` now delegates to a shared `applyLlm` helper, reducing duplication and ensuring consistent provider/model/permission handling across workspaces and tasks.
- Opening a task in a different workspace now restores that task's own pinned model/provider (falling back to the workspace default only if the task has no saved selection).
- Deleting a running task now also removes its pinned model/provider from settings.
- Workspace LLM persistence (`persistWorkspaceLlm`) now also pins the current selection to the active task, so each chat keeps its own model.

### Fixed
- Deleting a running task now correctly removes its pinned model/provider from settings, preventing stale selections from persisting.
- Switching to a task in a different workspace now correctly restores that task's own model/provider instead of always switching to the workspace default.

## Ascora ADE 1.1.0
What's new?

### Added
- OpenRouter can now be enabled as a cloud OpenAI-compatible backend with a saved local API key, provider picker entry, model refresh, chat streaming, and OpenRouter-specific connection status.
- OpenRouter model selection is persisted with workspace LLM settings and used consistently for agent chat, Git branch naming, Git commit message generation, and usage analytics.
- Agent backend settings are now reachable from the left rail.
- Agent runs can now keep progressing in the background when switching workspaces, tasks, SSH terminals, or starting a new task, then restore their live state when reopened.
- Claude usage now opens an in-app breakdown modal from the status bar with per-window bars, reset times, refresh, and a detailed usage link.
- LM Studio reachability is now probed in the background so provider pickers can reflect whether the local server is available even when another backend is selected.
- New Composer component for chat input with enhanced UI.
- AgentChat view for interactive agent communication.
- Copilot authentication modal and IPC support for Copilot integration.
- Expanded global styling with new UI tweaks.
- Updated ConnectionSettings component with additional provider options and UI improvements.
- UsageModal enhancements for better usage analytics display.
- Store extended with new slices for Copilot and UI state.
- New IPC modules for Copilot handling.

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
- Various UI glitches and TypeScript type issues across renderer components.
- Corrected copy‑text shortcuts in terminals (Ctrl/Cmd+C) and right‑click behavior.
- Fixed header casing for OpenRouter Authorization (already in 1.1.0, but reaffirmed).

### Changed
- LM Studio is shown in backend pickers only while it is reachable or already selected, and OpenRouter setup controls only appear when OpenRouter is active.
- **Version bumped to 1.1** in the About menu (left rail).
- StatusBar component updated to reflect new connection status indicators.
- ConnectionSettings UI now dynamically shows backend availability.
- Global CSS updated with new layout rules and theme adjustments.
- Store logic refined for better state persistence and performance.

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
