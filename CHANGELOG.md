# Changelog

All notable changes to the Tua plugin. Versions follow `version` in `.claude-plugin/plugin.json`; raise it with every release.

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
