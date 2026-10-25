# Project architecture and continuation context

**Snapshot date:** 2026-10-24  
**Project:** `DEMO-agency-office`  
**Project root:** `/Users/mac/Documents/CODE-AI-AGENT/DEMO-agency-office`

This note captures the current design, the content-team redesign, and the recent Codex/Claude CLI work so a later session can continue without rediscovering the project. Short version for Claude: [CLAUDE.md](CLAUDE.md). Harness review and backlog of proposals: [HARNESS_REVIEW.md](HARNESS_REVIEW.md). It describes the source as inspected on the snapshot date; confirm current files before acting on it.

## Project purpose

A small Node.js web app that presents a virtual office of AI agents, now configured for a **content marketing team**. A user (CEO) submits a task to the Content Lead (`manager`), which routes work through the team's operating process (`images/quy-trinh-van-hanh-team-content.png`), tracks progress, runs review gates with revision rounds, and saves a report. Agents can consult permitted colleagues and use bounded file, image, document, and web tools. The user can drag and drop files onto the page to attach them to a task.

The app supports direct provider API calls and local provider CLIs. The recent requested path is using an already-authenticated Codex CLI or Claude Code CLI on the same computer that runs the server, without copying OAuth credentials into this app.

## Architecture

| Area | Files | Responsibility |
|---|---|---|
| HTTP server and app routes | `server.js` | Serves `public/`, handles `/poll`, `/task`, report routes, agent editing, permissions, config saves, and `/auth/connect`. Keeps transient event history and process state in memory. |
| Browser UI | `public/index.html`, `public/app.js`, `public/style.css`, `public/reports.html` | Virtual office (rooms laid out by index of `rooms`), agent/task status with revision labels, settings dialog, agent editor (incl. gate flag), permission prompts, multi-line composer with workflow template chips and drag-drop/paste/pick file attachments, reports listing. Native browser APIs and polling; no front-end framework. |
| Agent definitions | `agents.json`, `agents.js` | Defines the 4 room names (`rooms`) and nine content-team agents with prompts, skills, `canAsk`, and optional `gate`. Validates/normalizes definitions and exposes manager planning, work (including attachments and revision feedback), summary, and answer helpers. |
| Task routing | `workflows.json`, `routing.js` | Keyword-based routing for the content process: full pipeline, measurement/insight, signals, backlog, brief, video edit, script, design. Supports conditional and parallel steps. `templates()` feeds quick-start buttons in the UI. Unmatched requests go to manager AI planning (LIVE) or `signal → planner` (MOCK). |
| Orchestration | `orchestrator.js` | Runs task dependency chains, serializes work per agent, supports colleague questions, runs **review gates** (re-runs the preceding producer steps with feedback, max 1 round, then blocks downstream if still rejected), passes the approved artifact downstream, summarizes, and emits final events. |
| Skills | `skills.js`, `skills/*.md` | Shared team knowledge decoupled from agents. Each file declares `agents: [ids]`, `["*"]`, or `rooms: [names]` in frontmatter; matched skills are injected into the agent system prompt (budget ~14k chars, ~4k for colleague answers), reloaded on file change. Agents cannot write to `skills/`. |
| Enzy ads reports | `enzy/fetch.js`, `enzy/metrics.js`, `enzy/index.js`, `enzy.json`, `prompt/daily-report-enzy-data-prompt.md`, `skills/70-enzy-ads-report.md` | Daily/weekly/monthly Facebook Ads reports for Enzy accounts 1,2,5,6,8: Playwright (installed Chrome) scrapes enzyfood.streamlit.app, code computes KPIs/tables/charts, `#analyst` writes insights; built-in scheduler and UI panel. |
| Attachments | `server.js` (`/upload`, `attachmentsOf`), `access.js` (`grantRead`) | Stores dropped files in `uploads/<date>/`, validates task file ids, grants session-only read access, and injects text previews into prompts. |
| AI provider adapter | `llm.js` | API adapters for Claude, OpenAI Chat Completions, and Gemini; also delegates to the CLI adapter. Supports tool-call loops. |
| Local CLI adapter | `cli.js` | Resolves and starts local CLI processes, strips provider API-key environment variables, passes prompts via stdin, and interprets a text JSON protocol for tools. |
| Runtime configuration | `config.js`, `config.json` | Loads API/CLI mode, provider/model, CLI paths, limits, source directory, and UI settings. UI changes are written to `config.json` using a temporary file and rename. |
| File permissions and tools | `access.js`, `permissions.json` | Requests and remembers separate read/write permissions; exposes file, image, DOCX, and directory tools. Protects selected application state files from agent writes. |
| Web research | `web.js` | DuckDuckGo HTML search and page fetch; blocks private-network destinations and limits response size. |
| Reports and exports | `report.js`, `export.js`, `docx.js`, `imaging.js`, `reports/` | Renders a self-contained HTML report with Markdown, tables, charts, and embedded images; exports supported formats and builds DOCX/images. |
| Persistent memory | `memory.js`, `memory.json` | Keeps up to 30 compact summaries and reuses up to three keyword-related entries on later tasks. |

## Content team design (2026-10-24)

| Step in the process image | Agent id | Room | Notes |
|---|---|---|---|
| 01 Collect signals | `signal` | Phòng insight | web_search + attachments; every signal needs source + context |
| 02 Backlog & priority, 03 Goals & brief | `planner` | Ban điều hành | backlog table P1/P2/P3, weekly list, full brief |
| 04 Script | `writer` | Phòng sản xuất | scene table with hook/body/key info/CTA/visual notes |
| 05 Review 1 (Leader) | `script_review` | Phòng kiểm duyệt | `gate: true` |
| 06 Video edit / visuals | `video`, `designer` | Phòng sản xuất | shot list, edit plan, SRT; thumbnails via `make_image` |
| 07 Review 2 (owner) | `video_review` | Phòng kiểm duyệt | `gate: true`, adds distribution checklist |
| 08 Measure, 09 Insight → new ideas | `analyst` | Phòng insight | metrics vs goals, hypotheses, experiments, ideas back to backlog; daily/weekly/monthly cadence |

Removed from the previous generic office: `secretary`, `reviewer`, `rag`, `content`, `dev`, `tester` (originals in `backups/before-content-team-20261024/`).

Gate contract: the reviewer's first line must be `KẾT LUẬN: DUYỆT` or `KẾT LUẬN: YÊU CẦU SỬA`. MOCK test hook: include `#sua` in the command to force one revision round.

### Typical request flow

1. Browser uploads dropped files to `POST /upload`, then posts `{task, files}` to `POST /task`.
2. `orchestrator.js` asks `routing.js` for a workflow. If none matches, the manager uses `agents.js` and the configured AI provider to make a plan.
3. Specialist work runs with per-agent serialization and declared dependencies. Agent tools are wrapped by `access.js`, which may pause for user permission. Gate agents can send work back to the previous producer step once.
4. Results flow back to the manager, which summarizes them unless the user addressed one agent directly (for example, `/dev ...`).
5. `server.js` builds and saves a report under `reports/`, emits the final event, and `memory.js` records a compact entry.

## Runtime and configuration

- Install Node.js 24 and dependencies with `npm install`; run with `npm start` and open `http://localhost:3000`.
- Default `MODE` is `MOCK`; real API mode requires a provider API key. API billing is separate from a ChatGPT subscription.
- `CONNECTION=CLI` uses locally installed and already-authenticated command-line apps. `REAL` + `CLI` requires the configured CLI to be detectable; otherwise config falls back to MOCK and records a note.
- Current inspected `config.json` values (no secret values copied here): `MODE=REAL`, `CONNECTION=CLI`, `AI_PROVIDER=gpt`, port 3000. The Codex CLI model is blank so Codex chooses its own default. `MODELS.gpt` remains `gpt-4o` for API mode; do not reuse that API model setting for Codex CLI.
- `SOURCE_DIR` controls the directory available to agent file tools. `config.js` validates it at startup and falls back to the app directory if it is missing or not a directory. Verify it when moving the project.
- `config.json` can contain provider API credentials. Treat it as secret; do not paste it into chat, reports, logs, or source control. Its current mode was observed as `0600`. Rotate any credential that may have been exposed previously.
- Generated task reports go in `reports/`; persistent memories go in `memory.json`; read/write grants go in `permissions.json`.

## Codex / Claude account connection

The settings dialog contains **Đăng nhập / xác thực** for GPT (Codex) and Claude. It calls `POST /auth/connect` with a provider allowlist, checks CLI availability, then performs a status check. On success it switches configuration to `MODE=REAL`, `CONNECTION=CLI`, and the selected provider. It does not return stdout/stderr or copy OAuth credentials into the browser/config file. If the session is absent, it tells the user to run `codex login` or `claude auth login` in a terminal on the server machine.

Recent CLI changes:

- `cli.js` resolves executables from the server process PATH and common macOS locations, including the Codex CLI bundled with ChatGPT. It uses the resolved executable for detection, auth status, and task execution.
- API key environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) are removed before invoking a CLI so the CLI uses its own session.
- Codex is run as `codex exec --skip-git-repo-check -s read-only [optional -m model] -`, with the prompt written to stdin.
- A legacy `CLI_MODELS.gpt=gpt-4o` is ignored/cleared because that was an API-oriented model setting causing a Codex CLI failure in the reported session. Blank model lets the installed Codex CLI select its supported default. If a later error remains, the adapter now includes the tail of CLI output instead of truncating to the first 300 characters; login guidance is only appended for auth-like errors.
- Claude Code CLI status is checked with `claude auth status`; Codex status is checked with `codex login status`.
- The task owner last reported an error where Codex v0.162.0-alpha.17.2 exited with code 1 and the error wrapper only showed startup metadata. The model mismatch was inferred from the shown `model: gpt-4o`; a successful real task run after the model fallback change has not been confirmed in this context.

## Current known risks and follow-up items

1. **HTTP access control needs a deliberate follow-up.** The original static review found no general authentication on task, agent, permission, config, or report routes. The app listens on the configured port without an explicit loopback host. If reachable from other devices, callers may be able to submit work or change settings/permissions. `/auth/connect` now requires a same-origin browser request, but that is not a replacement for server authentication. Prefer local-only binding unless remote access is explicitly needed; otherwise implement authentication and CSRF protections consistently for all routes.
2. **Verify a real Codex request after restarting the Node server.** The CLI discovery/model fallback changes require a server restart. Use the UI, then inspect the complete new error if it still fails; do not expose API keys or OAuth tokens in diagnostics.
3. **Confirm `SOURCE_DIR` points to the intended checkout.** A copied config may retain a path from another machine or checkout; `config.js` silently falls back to the app directory when it cannot validate the configured path.
4. README refers to `docs/SOCIAL-COLLAB-LOOP.md`, which does not exist. Either add the referenced document or update the link.
5. The package defines only `npm start`; no automated test script. The content-team redesign was tested end-to-end in MOCK mode only (API script + browser), not with a real AI provider.
6. `/upload` accepts files from any same-origin page with no authentication and `uploads/` has no cleanup; see HARNESS_REVIEW.md P1.
7. `permissions.json` still lists paths from another machine (`/Users/phamvannam/...`).

## Session history / continuation notes

- User asked where to get a GPT account token and whether API credits are required. Clarified that an API key is separate from a ChatGPT login/subscription and API billing is separate.
- User requested a source review of this project, focusing on GPT/Codex authentication. Static review found API-key storage in `config.json` and missing general HTTP authentication/access controls.
- User requested a login/auth button for already logged-in Codex or Claude CLI accounts. Added the auth-check and auto-activate flow described above.
- Initial button error said CLI `codex` could not be found. Terminal inspection showed Codex CLI was available and logged in; added PATH and macOS bundled-app executable resolution.
- A subsequent task failed with Codex exit code 1 and logged `model: gpt-4o`. Added fallback to Codex CLI default model for legacy `gpt-4o` CLI config and improved error-tail reporting. No real task run has confirmed the fix yet.

## Working conventions for the next session

- Read this file and `README.md`, then inspect the current source/config before making assumptions; this is a snapshot, not an executable specification.
- Never print or quote API keys, OAuth tokens, or credential-bearing files. When inspecting `config.json`, use a script that selects only non-secret fields.
- Keep CLI and API model configuration separate. For Codex CLI, leave model blank unless a model explicitly supported by the installed CLI/account is selected.
- Preserve the current permission-prompt behavior for file reads/writes and ask before relaxing it.
- After a user-facing source change, restart `npm start` before judging runtime behavior. Report whether a real CLI call was actually exercised.
- Project root did not appear to contain a Git repository when inspected; do not assume `git status` or commits are available.

## Session history (continued, 2026-10-24)

- Diagnosed Claude login failure in the app: `resolveCommand` added the bundled Codex path for every command, so `claude` resolved to Codex; fixed in `cli.js`. Claude Code CLI was then installed at `~/.local/bin/claude`; the CLI login (`claude auth login`) had not been completed at the time of writing. Desktop-app sign-in is not shared with the CLI.
- Redesigned agents/workflows for the content team, added review gates with revision, room names in `agents.json`, drag-and-drop attachments, multi-line composer, workflow template chips, and revision labels. Backed up originals to `backups/before-content-team-20261024/`. Verified in an isolated MOCK copy on port 3017: upload + same-origin check, invalid file id rejection, script workflow with one revision round, full 7-task pipeline with parallel steps and revisions, UI drop/chips/templates with no console errors.
- Added `skills/` (11 content-team skills: operating system, brand voice template, compliance, signal listening, backlog/brief, script writing, channel specs, video production, visual design, review checklists, metrics/insight) and `skills.js` loader. Skills are selected by frontmatter, not by `agents.json`, so adding/editing/deleting agents leaves them intact (verified via API in MOCK: skills folder hash unchanged, new agent in Phòng kiểm duyệt auto-received shared + room skills, `rooms` preserved in agents.json). Agent popup shows matched skills. `access.js` now blocks agent writes to `skills/`, `agents.json`, `workflows.json`.
- Added automatic Enzy ads reporting (see CLAUDE.md section). Installed `playwright-core@1.48.2` (uses `/Applications/Google Chrome.app`, no browser download). Site structure surveyed in the built-in browser after the user signed in themselves; login form probed headlessly without credentials. Verified: parser/report builder on a fixture of observed data, scheduler due-logic, end-to-end MOCK run with `ENZY_FAKE_RAW` (status, queue de-dup, data markdown, final HTML with appendix charts), real fetch path stops with a clear error when credentials are missing. Not yet verified: a real logged-in fetch (user must fill `enzy.json` USER/PASS and press "Chạy báo cáo ngày").
- Added customer-voice insight memory (`insight/`: store, voc scraper, distill, runner) + clarify-before-ideation (`clarify.js`, ask cards in UI, `POST /ask/answer`) + `idea` workflow and skill `80-len-idea-insight`. Scrapes the site's "Ý kiến khách hàng" in sequential non-overlapping windows of at most 7 days, distills each window into themes merged into `data/insight/kb.json`, and feeds a short digest (+ `insight_search` tool) to the agents. See docs/CLAUDE.md section "Ý kiến khách hàng → kho insight → lên idea". Scraper selectors written from a screenshot, not yet run against the live site.

