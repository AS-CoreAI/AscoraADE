## Ascora ADE 1.1.0
What's new?

### Fixed
- Codex change summaries now fill per-file `+N/-N` line counts in the changes popover when the CLI does not report them directly, using git stats as a fallback.
- Local and SSH terminals now copy selected text with `Ctrl/Cmd+C`; right-click also copies the current selection.


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
