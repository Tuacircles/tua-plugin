# Privacy Policy — Tua plugin for Claude

*Tua Circles Holding AS · Oslo, Norway · Last updated 19 October 2026 · Contact: tech@tuacircles.com*

This policy covers the **Tua plugin** (MCP server, skills and hooks) distributed through Anthropic's directory and from <https://github.com/tuacircles/tua-plugin>. The Tua apps and website have their own policy at <https://tuacircles.com/privacy-policy>.

## 1. Summary

The Tua plugin runs entirely on your computer. It collects no data for Tua Circles, sends no data to Tua Circles or to any third party, and needs no account or credentials. Everything it stores is in a folder you chose and can delete.

## 2. Data collection

We collect nothing. Installing, running or removing the plugin sends no usage statistics, crash reports, identifiers or content to us. There is no telemetry, no analytics and no update check in the plugin.

## 3. What the plugin processes on your machine

When you ask it to (a tool call, a hook you left enabled, or a file you place in `Innboks`), the plugin reads your own content and writes it as markdown files ("atoms") into your archive folder:

- text you ask Claude to save, and deliverables Claude composes from your atoms;
- in Claude Code, when auto-capture is on: long answers from Claude, text documents Claude writes for you, and a session summary (prompts, files written, last answer);
- on request ("ta med historikken"): your Claude Code sessions (`~/.claude/projects`), your Cowork sessions and Claude Desktop conversations as they are stored by the Claude apps on this machine (Claude Desktop's cache is copied to a temporary file before decoding and never modified), documents in Downloads/Documents/Desktop that originate from an AI service (identified from download metadata or by matching their hash to something Claude wrote), and conversation exports you place in `Innboks`;
- a public `https://claude.ai/share/<id>` page, only when you paste such a link; fetched with one plain request, no cookies, no login.

Conversation content may contain personal data about you and about people mentioned in it. It stays in your folder.

## 4. Usage and storage

- **Archive folder** — chosen by you on first use: `~/Tua`, or a folder synced by iCloud Drive, Dropbox, OneDrive or Google Drive. If you choose a synced folder, that provider's terms apply to the sync, exactly as for any other file there. Tua Circles has no access.
- **`~/.tua/config.json`** — the archive location.
- **`<archive>/.tua/`** — index, previous versions of atoms, a delivery log (which atom was fetched at which level, when — metadata only, never content) and a hook log.
- **Plugin data directory** (`TUA_DATA_DIR`, set by Claude Code) — a machine-local cache: derived index and the state of the last Desktop-cache and Finder scans.

The plugin never deletes a file. Files you drop in `Innboks` are moved to `Innboks/Ferdig` after import.

## 5. Third-party sharing

None. The plugin sends no data to Tua Circles, and no data to Anthropic beyond what the Claude client itself exchanges when it calls a tool (tool arguments and results, governed by Anthropic's terms). The only outbound network requests are the share-link fetch described above and a loopback check (`HEAD http://127.0.0.1:5274/`) to see whether your local map is running. Neither carries your content. The plugin never calls claude.ai's internal API and never uses your cookies or tokens.

## 6. Data retention

Your data stays as long as you keep the files. To delete one atom, delete its file. To delete everything, delete the archive folder and `~/.tua`. Previous versions and logs under `<archive>/.tua/` remain until you delete them. Uninstalling the plugin removes the plugin's own cache directory; it never touches your archive.

## 7. Your rights and contact

Because Tua Circles holds no data about you, there is nothing for us to access, correct, export or erase on request — you hold it all, as plain files. Questions about this policy, or security reports, go to **tech@tuacircles.com**. We answer within five working days.

## 8. Changes

Changes to this policy are published in this file and in the plugin's README, with the date at the top and an entry in `CHANGELOG.md`.
