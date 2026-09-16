# Repository instructions

## UI copy

Use functional labels, screen titles, status messages, instructions, and errors only. Screen titles should name the screen (for example, "Settings").

Do not add marketing slogans, decorative headings, motivational filler, or conversational empty-state copy unless the user explicitly requests it. An empty state should describe the state directly, such as "No events."

## Documentation

Update the authoritative documentation in the same commit as changes to behavior, setup, commands, configuration, APIs, architecture, operations, compatibility, or known limitations. Keep implemented behavior distinct from planned work, and do not describe proposed hardware targets as measured results.

Use these files as the sources of truth:

- `README.md`: project overview, ordinary installation, basic use, status, and links to detailed guides.
- `docs/DEPLOYMENT.md`: Windows and Raspberry Pi installation, operation, timezone configuration, updates, and local data.
- `docs/DEVELOPMENT.md`: contributor setup, checks, diagnostics, local state, and code map.
- `docs/DESIGN.md`: current interface behavior, visual rules, accessibility, and product boundaries.
- `docs/BACKEND.md`: service API, validation, calendar ingestion, persistence, synchronization, and security limits.
- `docs/HARDWARE-TEST.md`: physical-device procedure, measurements, and acceptance evidence.
- `docs/PLAN.md`: future work, unresolved decisions, and unmeasured targets.

Keep the README concise and link to the detailed guides instead of duplicating them. Update an existing guide before creating another document. Run `npm run check:docs` after changing Markdown; the check validates local targets, filename casing, and headings.

## Required checks

Run the smallest set that covers the change, and run the full set for changes spanning the interface and service:

- TypeScript logic or frontend configuration: `npm test` and `npm run build`.
- Styling, responsive layout, browser state, or interaction behavior: the frontend checks plus `npm run test:browser`.
- Python service, ingestion, storage, or synchronization: `.venv\Scripts\python.exe -m pytest` on Windows or `.venv/bin/python -m pytest` on Linux.
- Service/UI integration or API client behavior: `npm run test:service-browser` in addition to the relevant frontend and Python checks.
- Documentation: `npm run check:docs`.

Use installed Chrome for Playwright when downloaded Chromium is unavailable by setting `PLAYWRIGHT_CHANNEL=chrome`.

## Git workflow

Treat `main` as the default branch. Before changing tracked files from `main`, create a task branch named `codex/<short-kebab-task>`. Continue an existing task branch only when the new work belongs to that task.

Inspect the current branch and worktree before editing. Preserve unrelated user changes and stage task-owned paths explicitly. Commit coherent, verified milestones without waiting for approval, and do not leave completed agent-owned work uncommitted. Follow existing commit conventions; when none exist, use Conventional Commit subjects.

Commit `package-lock.json` with dependency changes. Do not commit local databases, credentials, virtual environments, dependency directories, build output, test artifacts, or generated reports covered by `.gitignore`.

After completing and committing a task, push the task branch and create or update a pull request to `main` without waiting for separate approval. The pull request title and description must reflect the final change and list the checks run. Do not merge pull requests, rewrite history, force-push, or delete branches unless the user explicitly requests it. After committing, report the branch, commit hashes, pull request URL, checks run, failures, and remaining work.
