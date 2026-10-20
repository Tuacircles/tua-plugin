# Changelog

All notable changes to the Tua plugin. Versions follow `version` in `.claude-plugin/plugin.json`; raise it with every release.

## 0.5.4 — 2026-10-20 (Desktop conversations are captured again — from the conversation store)

- **Why.** Since Claude Desktop 2.42304 (around 15 September 2026) the app no longer keeps conversation content in its HTTP cache, only small notices. Tua's Desktop reader therefore saw nothing newer than mid-September although it ran every ten minutes, and Cowork sessions — which now run through claude.ai with the Mac as a device — left no local transcript at all.
- **Where the conversations are.** Desktop keeps the last-opened chat and Cowork conversations in a Chromium IndexedDB (`IndexedDB/https_claude.ai_0.indexeddb.leveldb`, database `claude-conversation-store`, object store `trees`): the full message tree for short conversations, the most recent window (`historyWindow: windowed`, from `floorIndex`) for long ones. Verified on 20 October: 30 conversations from 1–20 October, including a 2 500-message Cowork session whose last 26 messages (51 000 characters) were only there.
- **`server/idb.js`** reads that store in plain Node, no native dependency: LevelDB table and log files (newest sequence number per key wins, deletions honoured), Snappy blocks, IndexedDB key prefixes and metadata, Blink envelopes (external blobs, Snappy values, trailers) and V8-serialised values. Cross-checked against CCL Forensics' `ccl_chromium_reader` (MIT) as the oracle. The LevelDB files are copied to a temp folder before reading; the `.blob` files are read in place; nothing is written to the app's folder.
- **`server/desktop.js`** merges the store into the existing cache reader (`collectDesktopStore`): the newest version per conversation wins, windowed conversations get a note at the top of L and in the meta line, the title comes from the cache's list replies or from the first message (`shortTitle`), and Cowork conversations (`proxiedCoworkSessionId`) are named after the folder the session was given access to (`desktopFolderGrants`, read from `claude_desktop_config.json`), as the Cowork import already does. Source becomes «Claude Cowork» with the tag `cowork`.
- **Dry run:** `TUA_FILES_ROOT=<scratch> TUA_DATA_DIR=<scratch>/data node server/test-desktop-store.mjs` (refuses to run against the real archive); `node server/test-idb.mjs` lists what the store holds.

## 0.5.3 — 2026-10-20 (the server ships as one file — no install step anywhere)

- **Why.** Claude Desktop downloads an account-enabled plugin from the directory as a plain copy of the repository and never runs `npm install`. With 0.5.0–0.5.2 the server crashed there with `Cannot find package '@modelcontextprotocol/sdk'` — in Cowork and in Claude Code sessions started from Desktop, where the account plugin shadows a locally installed copy of the same name. The 0.5.1 fix (no `${user_config}` in `.mcp.json`) was necessary but not sufficient.
- **The server is bundled.** `node bygg.mjs` (esbuild) writes `server/tua-server.bundle.mjs` (~1.2 MB: server + `@modelcontextprotocol/sdk`, `ext-apps`, `zod`) and copies the card's client library to `server/apps/app-with-deps.js`. `.mcp.json` and the `.mcpb` manifest point at the bundle; `server/*.js` remains the source for development, tests, hooks and the command-line tools (none of which need an external package). `apps.js` reads the vendored client library when present, else `node_modules` (dev).
- **Proof.** New test `bundle` in `test-platform.mjs` copies the plugin without `node_modules` and talks real MCP to the bundle: initialize, 11 tools, `ui://tua/kort` with the client library inlined, `tua_save` and `tua_search`. It also fails if the bundle is older than `server/*.js` or carries another version than `plugin.json`.
- **Rule.** Run `node bygg.mjs` after every change in `server/`, before commit and push.

## 0.5.2 — 2026-10-20 (two fixes found on 14 October that never reached main)

Both were made and tested in the M14 session on 14 October but stayed uncommitted in that session's worktree; recovered 20 October.

- **Files deleted in Finder stay deleted.** `load()` had a safety net that re-added atoms from the derived index (`atoms.json`) when their file was missing, so a file you deleted in Finder came back at the next save. Removed: when the archive folder exists it is the only truth; the index is used only when the folder is absent (another machine).
- **Data dumps are not atoms.** Answers and documents that are mostly numbers (id/price tables such as `10027245·450000 10059885·140000 …`) are skipped by the import and by the Stop/Write hooks (logged as `data-dump`), and a title is never taken from a line of numbers — the first line with letters is used instead. Rule: a line is data when at least two and at least half of its words contain digits; a text is a dump when at least 60 % of its lines are data lines (or, for one or two lines, at least eight data words making up half the words). Conversations are never filtered this way, only the auto-captured answers and files.

## 0.5.1 — 2026-10-20 (the MCP server starts in Cowork)

- **`.mcp.json` no longer references `${user_config.arkivmappe}`.** Cowork ignores an MCP server whose definition references a plugin setting without a default, and does not collect settings at all, so since 0.3.0 a directory install gave Cowork the skills but no tools. The server now gets only `TUA_DATA_DIR` from `${CLAUDE_PLUGIN_DATA}` and finds the archive the way it always could: `TUA_FILES_ROOT` (standalone installs), then `~/.tua/config.json`, then an existing Tua folder, else it asks.
- **The *Arkivmappe* setting still works in Claude Code.** Claude Code exports it to hook processes; the SessionStart hook now writes it to `~/.tua/config.json` through the same `chooseArchive` that `tua_setup` uses (same fields: `root`, `sted`, `valgt`), only when it is set and differs from what the file says, and logs the write in `hooks.jsonl`. An empty setting never overwrites a choice made with `tua_setup`. The server re-reads the file at the first tool call if it had no archive at startup, so the setting takes effect in the same session.
- **Unreplaced `${…}` in `TUA_DATA_DIR`/`TUA_FILES_ROOT` is ignored** (a host that passes the raw variable gets the default data folder instead of a folder literally named `${CLAUDE_PLUGIN_DATA}`).
- **Honest limits, per surface** (README): claude.ai chat = skills only; Cowork = server + skills from the plugin, and Tua shows twice if a Desktop connector named `tua` is also on; Claude Code = server + skills + hooks.
- Test: `test-platform.mjs` case `hook-konfig` proves the hook writes the setting, a server started without `TUA_FILES_ROOT` and with a raw `${CLAUDE_PLUGIN_DATA}/data` finds the archive from the file, and an empty setting leaves the file alone.

## 0.5.0 — 2026-10-20 (M24: skills as intents)

- **Two new skills.** `/tua_start` — onboarding in one go: `tua_import(kilde=alt)` with a dry run first, then the real import, confirms auto-capture is on, and sets up `tua_auto` for the repository you are in. `/tua_status` — read-only: atoms per project, what is still outside Tua (Code, Cowork, Desktop cache, documents, Innboks), whether the hooks have saved anything lately, and whether this repository is mirrored.
- **SessionStart hook** now points to `/tua_start` when nothing has ever been imported, and offers `/tua_auto` once per repository (per 30 days, remembered in `<archive>/.tua/auto-tilbudt.json`) when the repository has no `.tua-sync.json`. Still a reminder only: nothing runs without a yes.
- Decision (V20): skills mirror what the user wants, not the tool surface — four skills is the ceiling; the eleven MCP tools stay tools.

## 0.4.1 — 2026-10-19 (after the directory submission)

- **Zip extraction in its own module.** The `unzip`/`tar` call that unpacks exports in `Innboks` moved from `server/import.js` to `server/unzip.js`, so the file that fetches a shared link no longer also spawns a process (one of the directory validator's heuristics). Behaviour unchanged.
- **Directory listing links.** `documentationUrl`, `supportUrl` and `privacyPolicyUrl` in `plugin.json` fill the Links section of the directory listing. Claude Code ignores them at load time; `claude plugin validate` before v2.1.281 reports them as unknown fields, which is expected.
- **"Automatisk fangst" is tested.** The hook has read the plugin setting since 0.3.0 (Claude Code exports every `userConfig` option to hook processes as `CLAUDE_PLUGIN_OPTION_<KEY>`); `test-platform.mjs` now proves that `false` stops the Stop, Write/Edit and session hooks from saving or logging anything while the SessionStart reminder still runs.
- **Known and kept: no MCP server in Cowork.** `.mcp.json` takes `TUA_FILES_ROOT` from the `arkivmappe` setting, and Cowork does not collect plugin settings, so the server does not start there (skills still load). The setting stays because Claude Code users can point Tua at an existing folder without a first-run dialog; Cowork support is a later decision.

## 0.4.0 — 2026-10-19 (M18: directory submission)

- **Self-contained plugin folder.** The server (`server/`), both skills and the hooks are real files in this folder; no symlinks. `package.json` + `package-lock.json` at the root so Claude Code installs the three dependencies (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`) on install.
- **Windows and Linux support.** New `server/platform.js` gathers everything OS-specific: Claude Desktop's data folder (`%APPDATA%\Claude`, `~/.config/Claude`), cloud folders per OS, "Open in …" via `explorer.exe`/`rundll32.exe`/`xdg-open`, download origin on Windows via `Zone.Identifier`, path filters that accept backslashes, `tar` as fallback for `unzip`. Finder tags remain macOS-only (tags are in the file either way). Hooks load the server through `file://` URLs. `TUA_PLATFORM` simulates another OS in tests.
- **Works without a cloud folder.** First run offers "Lokalt (~/Tua)" when no iCloud/Dropbox/OneDrive/Google Drive folder exists; Tua still never guesses.
- **Node ≥ 22.15 required** (zstd decoding of Claude Desktop's cache); a clear error instead of a silent miss on older Node.
- **Directory requirements.** `LICENSE` (AGPL-3.0), English README with a complete "runs / reads / writes / sends" list and a Privacy Policy section, `PRIVACY.md`, `SUBMISSION.md` with the answers for the developer portal, `privacy_policies` in the `.mcpb` manifest, `license`/`homepage`/`repository` in `plugin.json`.
- **Tests never touch the real archive.** `test-client.js` and `test-apps.mjs` refuse to start without `TUA_FILES_ROOT`/`TUA_DATA_DIR` and pass the environment to the server explicitly. New `server/test-tools.mjs` (every tool once over MCP, including first run) and `server/test-platform.mjs` (fallback branches).
- `pakk.mjs` builds into `dist/` inside the plugin folder; the `.mcpb` declares `darwin`, `win32` and `linux`.

## 0.3.0 — 2026-10-14 (M14–M17)

- Plugin packaging: manifest, local marketplace, `.mcp.json`, skills `tua` and `tua_auto`, hooks (SessionStart reminder, Stop, PostToolUse Write/Edit, PreCompact/SessionEnd).
- First run asks where the archive should live (elicitation in Claude Code, `tua_setup` elsewhere); welcome atom and onboarding lines; "archive first" server instructions; annotations on every tool.
- History without exports: Claude Code sessions, Cowork sessions, Claude Desktop cache reader (conversations with project, documents, artifacts, shared links), Finder connector by reference, `tua_import(kilde=alt)` with dry run.
- `Innboks`: Claude export (manifest + category zips) and ChatGPT export become atoms; shared links as `.url`/`.webloc`/`.txt`.
- The Tua card as an MCP App (`ui://tua/kort`, `tua_card`, `tua_open`).

## 0.2.0 — 2026-10-14 (M7–M13)

- S/M/L levels in the files, level per reference, versions, "Open in …" links, deliverables with `bygget_av`, delivery log, Vault tag, file lock, the map as a local app.

## 0.1.0 — 2026-10-12 (M2–M5)

- First MCP server: `tua_save`, `tua_search`, `tua_get`, `tua_list`, `tua_link`, `tua_unlink`; the folder is the truth (one markdown file per atom).
