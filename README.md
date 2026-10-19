# Tua — the local-first archive for everything you make with AI

Tua turns every piece of AI work into an **atom**: a plain markdown file in a folder you own, with provenance (project, conversation, source, date) attached automatically. Save with one sentence, find it again from any project or tool, and bring in your whole history from Claude Code, Cowork and Claude Desktop without exports. Nothing leaves your machine — Tua has no server, no account and no key to your content.

Tua is a Norwegian-language product (tool descriptions, skills and answers are in Norwegian). The archive format is plain UTF-8 markdown with YAML front matter, readable in Finder, Spotlight, Explorer, Obsidian or any editor.

**Surfaces:** Claude Code (MCP server, skills, hooks) · Claude Desktop and claude.ai Cowork (MCP server, skills, the Tua card as an MCP App) · macOS, Windows and Linux.

> Norsk bruksanvisning: se [Norsk](#norsk) lenger ned.

## What you get

| Part | What it does |
|---|---|
| **MCP server** `tua` | Eleven tools: `tua_save`, `tua_search`, `tua_get`, `tua_list`, `tua_link`, `tua_unlink`, `tua_compose`, `tua_setup`, `tua_import`, `tua_card`, `tua_open`. Every tool has a title and `readOnlyHint`/`destructiveHint`; no tool ever deletes anything. |
| **Skill** `tua` | How to save, find and share atoms: short ingress (S) always, summary (M) for long content, fetch M before L, offer before writing. |
| **Skill** `tua_auto` | Mirror a git project (commit log, manifest, decision log, PDF-backed documents) into Tua after every commit. |
| **Hooks** (Claude Code only) | `SessionStart` reminder when history is waiting to be imported · `Stop` saves long answers · `PostToolUse Write/Edit` saves text documents you write · `PreCompact`/`SessionEnd` saves a session summary. All can be turned off with the plugin setting **Automatisk fangst**. |
| **The Tua card** | An MCP App (`ui://tua/kort`) that renders a hit list or one atom inside Claude Desktop, claude.ai, Cursor and VS Code, with S → M → L on demand and "Open in …" buttons. |

### How an atom works

Every atom has three levels: **S** (ingress, ≤ 300 characters), **M** (summary, written when content is long) and **L** (everything). Search answers with S. Claude fetches M before L, and other projects see an atom only at the level you give them (`tua_link`). Levels are stored in the file itself, so the archive stays readable without Tua.

```
~/Dropbox/Tua/                 ← or iCloud Drive, OneDrive, Google Drive, or a local folder
  Riulf/Likviditet høst 2026.md
  Hytta/Vedlikehold 2027.md
  Innboks/                     ← drop exports or shared links here
  .tua/                        ← index, versions, logs (metadata only)
```

## Install

Tua needs **Node.js 22.15 or newer** (24 recommended) on the `PATH`. Dependencies are installed by Claude Code from `package-lock.json` when the plugin is installed.

**From the directory (once listed):** add Tua from claude.ai › Customize › Plugins. It syncs to Claude Code and Cowork.

**From this repository:**

```bash
claude plugin marketplace add github:tuacircles/tua-plugin
claude plugin install tua@tua-lokal
```

**From a local checkout:** `claude --plugin-dir ./tua-plugin` (no persistent configuration), or `claude plugin marketplace add ./tua-plugin && claude plugin install tua@tua-lokal`.

**Claude Desktop (standalone, without the plugin system):** `node pakk.mjs` builds `dist/tua.mcpb`; double-click it in Claude Desktop.

### First run

The first tool call asks where the archive should live — iCloud Drive, Dropbox, OneDrive, Google Drive or a local folder (`~/Tua`). Tua never guesses: in Claude Code the question is a form; elsewhere Claude asks you and calls `tua_setup`. The choice is stored in `~/.tua/config.json` and the folder gets one welcome atom. Then Tua offers, once, to bring in your history ("Jeg fant N Code-økter …"); nothing is imported without your yes.

### Settings

| Setting | Effect |
|---|---|
| **Arkivmappe** | Overrides the archive location (`TUA_FILES_ROOT`). Leave empty to be asked on first use. |
| **Automatisk fangst i Claude Code** | On by default. Off = hooks save nothing; you save only when you say "lagre dette til Tua". The SessionStart reminder stays. |

## What the plugin runs, reads, writes and sends

This section exists so that nothing Tua does is a surprise. It is the complete list.

**Runs:** `node server/server.js` (the MCP server, over stdio) and `node hooks/tua-hook.mjs` (the hooks). The server spawns, with fixed arguments and never through a shell: on macOS `open`, `mdfind`, `mdls`, `xattr` and `python3` (Finder tags); on Windows `explorer.exe`, `rundll32.exe` and `tar`; on Linux `xdg-open`; on all platforms `unzip` or `tar` (exports in Innboks) and `git` (only when you run the `tua_auto` skill). Optional, started by you: `node server/bridge.js` — a local map of the archive on `http://127.0.0.1:5274/`, bound to loopback only.

**Reads (local, read-only):** your archive folder; `~/.claude/projects/*/*.jsonl` (Claude Code sessions); Claude Desktop's own data folder — the HTTP cache (`Cache/Cache_Data`, copied to a temp file before decoding, never written) and Cowork sessions (`local-agent-mode-sessions/*/audit.jsonl`); download metadata in Downloads, Documents and Desktop (Spotlight "where from" on macOS, `Zone.Identifier` on Windows) plus file hashes to match documents Claude wrote. Hooks read the hook input Claude Code gives them (the last answer, the file you wrote, the transcript path).

**Writes (local):** atoms as markdown files in your archive folder and metadata under `<archive>/.tua/` (index, previous versions, delivery log, hook log — never content outside the atoms); `~/.tua/config.json` (archive location); a small machine-local cache in the plugin data directory (`TUA_DATA_DIR`: derived index, Desktop-cache and Finder scan state); when you run `tua_auto` in a repository: `.tua-sync.json` and `.git/hooks/post-commit` in that repository. Finder tags on macOS. Tua never deletes a file; files in `Innboks` are moved to `Innboks/Ferdig` after import.

**Sends / fetches over the network:** nothing, with two exceptions, both local-first and disclosed in the tool descriptions. (1) `tua_import(kilde=lenke)` fetches a public `https://claude.ai/share/<id>` page that *you* pasted, with one plain GET, no cookies, no login; today that page is an app shell, so the atom is a pointer that fills in when you open the link in Claude Desktop. (2) `tua_open(target=kart)` sends one `HEAD` to `http://127.0.0.1:5274/` to check whether your local map is running. Tua never calls claude.ai's internal API, never uses cookies or tokens, has no telemetry, no analytics and no update check. Your cloud provider syncs the folder if you chose one — that is your account, not ours.

**Credentials:** none. Tua needs no API key, no login and reads none of yours.

## Privacy Policy

*Also published as [PRIVACY.md](PRIVACY.md) in this repository and at <https://tuacircles.com/privacy-policy>. Last updated 19 October 2026.*

**Who we are.** Tua Circles Holding AS, Oslo, Norway (org. no. in the Norwegian Register of Business Enterprises). Contact: <tech@tuacircles.com>.

**Data collection.** The Tua plugin collects no data for us. It runs entirely on your computer. We receive nothing when you install, run or remove it — no usage statistics, no crash reports, no identifiers.

**What the plugin processes locally.** On your request it reads your own content — conversations and documents from Claude Code, Cowork and Claude Desktop stored on your machine, text you ask it to save, exports you place in `Innboks` — and writes it as markdown files to the archive folder you chose. Conversation content captured by the hooks (long answers, documents, session summaries) is personal data about you and whoever appears in it; it stays in your folder.

**Usage and storage.** Everything is stored in the folder you chose (`~/Tua`, or a folder synced by iCloud Drive, Dropbox, OneDrive or Google Drive — then that provider's terms apply to the sync, exactly as for any other file in that folder), in `~/.tua/config.json`, and in a machine-local cache. We have no access to any of it.

**Third-party sharing.** None. The plugin sends no data to Tua Circles, to Anthropic beyond what the Claude client itself does when it calls a tool, or to anyone else. The only outbound requests are the two listed above (a public share link you pasted; a loopback check), and neither carries your content.

**Data retention.** Data stays as long as you keep the files. Delete an atom by deleting its file; delete everything by deleting the folder and `~/.tua`. Previous versions live in `<archive>/.tua/versions/` and the delivery log in `<archive>/.tua/utlevering.jsonl` (metadata only: tool, atom id, level, time) until you delete them. Uninstalling the plugin removes the plugin's cache directory, never your archive.

**Your rights.** Because we hold no data about you, there is nothing for us to access, correct or erase on request — you hold it all. For questions, or to report a security issue, write to <tech@tuacircles.com>.

## Support and documentation

- Documentation: this README and the [Norwegian section](#norsk) below; the skills describe the workflow in detail.
- Support: <tech@tuacircles.com> · Issues: the issue tracker of this repository.
- Changes: [CHANGELOG.md](CHANGELOG.md). License: [AGPL-3.0](LICENSE).

## Norsk

**Tua er arkivet for det du lager med AI.** Hvert stykke arbeid blir et *atom*: en markdown-fil i din egen mappe, med proveniens (prosjekt, samtale, kilde, dato) festet automatisk. Lagre med «lagre dette til Tua», finn igjen med «hva har jeg om …» fra et hvilket som helst prosjekt, og ta med hele historikken fra Claude Code, Cowork og Claude Desktop uten eksport. Ingenting forlater maskinen din.

**Slik virker det.** Si «lagre dette til Tua» — Claude skriver ingressen (S) selv, og sammendraget (M) når innholdet er langt. Spør «hva har jeg om likviditet» — treffene svarer med S, og Claude henter M før L. Si «gjør dette synlig i Riulf» — atomet blir en referanse i det prosjektet, på nivået du velger. Si «lag et styrenotat av disse» — `tua_compose` bygger en leveranse med sporing tilbake til kildene.

**Første gang** spør Tua hvor arkivet skal ligge (iCloud Drive, Dropbox, OneDrive, Google Drive eller lokalt). Valget lagres i `~/.tua/config.json` og kan endres med `tua_setup`. Deretter tilbyr Tua én gang å ta med historikken: `tua_import(kilde=alt, dryRun=true)` viser tallene først, og ingenting importeres uten at du sier ja.

**Historikken (M17):** «Ta med historikken» leser alt som finnes lokalt, uten eksport og uten innlogging: Code-økter (`~/.claude/projects`), Cowork-økter (`audit.jsonl`), Desktop-samtaler (fra Claude Desktops egen cache — alt som har vært åpnet i Desktop, med prosjekt; leses også av seg selv hvert 10. minutt) og dokumenter med AI-opphav i Nedlastinger/Dokumenter/Skrivebord (ved referanse, aldri kopi). Delte lenker (`claude.ai/share/…`) limes inn eller legges i Innboks; innholdet fylles når lenken åpnes i Desktop. Tua kaller aldri claude.ai sitt interne API.

**Installere lokalt:** `claude plugin marketplace add ./tua-plugin` og `claude plugin install tua@tua-lokal`, eller `claude --plugin-dir ./tua-plugin` for én økt. `node pakk.mjs` lager `dist/tua-plugin.zip` (claude.ai › Customize › Plugins › Upload) og `dist/tua.mcpb` (Claude Desktop). Tester: `npm test` (MCP over stdio), `node server/test-tools.mjs` (alle elleve verktøy én gang), `node server/test-platform.mjs` (Windows/Linux-grenene simulert på macOS) — alle mot en tom scratch-mappe, aldri mot arkivet ditt.

**Ærlige grenser.** Chat på claude.ai (web/mobil) kjører ikke lokale servere — der virker bare skillene. Hooks finnes bare i Claude Code (og Cowork), ikke i Desktop-chat; Desktop-samtaler fanges i stedet fra appens cache. Finder-tagger settes bare på macOS; på Windows og Linux står taggene i fila. Plugins forutsetter betalt Claude-plan. Node 22.15 eller nyere kreves (zstd-dekoding av Desktop-cachen).
