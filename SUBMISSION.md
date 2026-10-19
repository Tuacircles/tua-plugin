# Submission notes — Tua plugin bundle

Everything to paste into the developer portal at <https://claude.ai/directory/manage> (Submit new → **Plugin bundle**). Written 19 October 2026 against the docs read the same day (`/docs/plugins/submit`, `/docs/plugins/pre-submission-checklist`, `/docs/connectors/building/submission`, `/docs/connectors/building/review-criteria`). Re-read them before submitting; they change.

> **Before you start:** (1) create the public GitHub repository `tuacircles/tua-plugin` (or another owner — then replace `tuacircles/tua-plugin` in `plugin.json`, `package.json`, `pakk.mjs`, `README.md`, `PRIVACY.md` and this file) with the contents of this folder at the repository **root** (plugin path empty — that avoids the "scripts the validator couldn't follow" hold for sub-folder plugins); (2) connect that GitHub account on claude.ai in the Tua Circles organization; (3) publish `PRIVACY.md` at an HTTPS URL you control — `docs/privacy-policy.html` is a ready-made standalone page for <https://tuacircles.com/plugin-privacy> — or keep the GitHub URL; (4) the icon is `icon.png` in this folder (512 × 512 PNG, 71 KB, the Tua app icon from tuacircles.com).
>
> The Norwegian step-by-step for everything that needs Erik's accounts (GitHub, claude.ai, e-mail, website) is in `docs/innsending-steg-for-steg.md`.

## Source step

| Field | Value |
|---|---|
| Repository | `tuacircles/tua-plugin` |
| Plugin path | *(empty — plugin is at the repository root)* |
| Branch or tag | *(empty — default branch `main`)*; or a tag such as `v0.4.0` if you want to control every release by moving the tag |

Then **Validate**. Expected findings and what they mean:

| Finding | Expected result | Why / what to do |
|---|---|---|
| `claude plugin validate` locally | ✔ passed (also `--strict`) | Run from the folder *above* the plugin: `claude plugin validate ./tua-plugin`. Note: with `.claude-plugin/marketplace.json` present the CLI validates the marketplace manifest; to validate `plugin.json` itself, run it on a copy without that file (what `node pakk.mjs` does). |
| **Dependencies install from a lockfile** | *Policy hold* (reviewer reads it) | `package.json` + `package-lock.json` in the root: Claude Code installs `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps` and `zod` on install. This hold is by design and cannot be avoided without bundling ~1 MB of SDK code into the repo (which would be held anyway as a file over 256 KiB). |
| **Scripts the validator couldn't follow** | Should **not** appear when the plugin is at the repository root | Appears only for sub-folder plugins that run `node` files. If it appears anyway, it is a hold, not a block. |
| README / LICENSE | ✔ | `README.md` (≫ 40 words), `LICENSE` (AGPL-3.0-only), `license` in `plugin.json`. |
| Name | ✔ `tua` | Distinctive product name, lowercase, no reserved words. `displayName` "Tua", `author.name` "Tua Circles Holding AS". If the portal reports "Name may be confused with an existing listing", answer that Tua is the registered product of Tua Circles Holding AS (tuacircles.com, live since 2024). |
| OS files | ✔ | `.gitignore` excludes `.DS_Store`, `Thumbs.db`, `desktop.ini`; check with `git ls-files \| grep -i ds_store` before pushing. |
| Symlinks | ✔ none | `server/` and `skills/tua` are real files since 0.4.0. |
| Launchers (`npx`, `uvx`) | ✔ none | Server and hooks run `node ${CLAUDE_PLUGIN_ROOT}/…` with plain arguments. |
| Credentials in files | ✔ none | Tua uses no API keys. `userConfig` has only a folder and a boolean. |
| Marketplace file | *possible warning* | `.claude-plugin/marketplace.json` lists this one plugin with `source: "./"` so people can install straight from GitHub. If the portal objects ("Pick one plugin first"), delete that file and push. |

## Listing details step

Read from `plugin.json` and the README. Check: name **Tua**, description (from `plugin.json`), author **Tua Circles Holding AS**, homepage/repository links, license **AGPL-3.0-only**, keywords. The listing description is the README; the English intro is written for that.

Listing materials, if the portal asks for them separately:

| Item | Value |
|---|---|
| Documentation URL | `https://github.com/tuacircles/tua-plugin#readme` |
| Privacy policy URL | `https://tuacircles.com/plugin-privacy` once `docs/privacy-policy.html` is published there; until then `https://github.com/tuacircles/tua-plugin/blob/main/PRIVACY.md` |
| Support contact | `tech@tuacircles.com` |
| Company | Tua Circles Holding AS, Oslo, Norway · `https://tuacircles.com` |
| Primary contact for review updates | Erik Teigen, `tech@tuacircles.com` |
| Icon | `icon.png` in the repository root — 512 × 512 PNG, 71 KB, the Tua app icon (favicon of tuacircles.com, upscaled from 257 px; replace with the designer's original for a sharper result) |
| Categories | Productivity · Notes & knowledge management · Developer tools |
| One-liner (≤ 200 chars) | The local-first archive for everything you make with AI: save with provenance, find it again across projects, bring in your Claude history — all as markdown files in your own folder. |

**Detail description (≤ 2 000 chars):**

> Tua turns every piece of AI work into an atom: a plain markdown file in a folder you own, with provenance (project, conversation, source, date) attached automatically. Say "lagre dette til Tua" and Claude writes the ingress; ask "hva har jeg om …" from any project and get the ingress back, with the summary and the full text only when you ask. Make an atom visible in another project as a reference, at the level you choose (S, M or L). Compose a deliverable from several atoms with tracking back to the sources.
>
> Bring in your history without exports: Claude Code sessions, Cowork sessions and Claude Desktop conversations are read from the Claude apps' own local files, and documents with AI origin in Downloads/Documents/Desktop are indexed by reference. Everything is shown as numbers first (dry run) and nothing is imported without your yes.
>
> Tua has no server, no account and no key to your content. The archive lives in a folder you choose — iCloud Drive, Dropbox, OneDrive, Google Drive or local — and is readable in Finder, Explorer, Spotlight, Obsidian or any editor. The plugin sends nothing to Tua Circles or to anyone else. macOS, Windows and Linux; Claude Code, Claude Desktop and Cowork. Norwegian-language product; the README is in English.

## Data handling step

| Question | Answer |
|---|---|
| Does the plugin read or store personal data? | **Yes — locally only.** It reads the user's own content (conversations and documents stored by the Claude apps on the user's machine, text the user asks to save, exports the user places in a folder) and stores it as markdown files in a folder the user chose on their own machine. No personal data is sent to or stored by Tua Circles. |
| Does it send data to services other than its declared connectors? | **No.** The plugin has no remote server and no connector. The only outbound requests are (1) one plain GET of a public `https://claude.ai/share/<id>` page when the user pastes such a link, without cookies, and (2) a `HEAD` to `http://127.0.0.1:5274/` (loopback) to check whether the user's local map is running. Neither carries user content. No telemetry, analytics or update checks. |
| How long does it keep data? | **As long as the user keeps the files.** Everything is plain files in the user's folder; deleting a file deletes the atom, deleting the folder deletes everything. Uninstalling removes only the plugin's local cache. See PRIVACY.md §6. |
| Is it intended for people under 18? | **No.** Tua is a tool for knowledge workers; it is not directed at children. |
| Which API does the server call? (connector-style question, if asked) | **None.** The server is local and calls no HTTP API; it reads local files. |
| Personal health data? Sponsored content? | **No** and **no**. |

## Compliance step

Contact email: `tech@tuacircles.com` (make sure the mailbox exists and is read before submitting; the portal sends review updates there).

The four acknowledgements (select all): the plugin complies with the Anthropic Software Directory Terms and Policy; the listing and README accurately describe what it does; Tua Circles will maintain its security and functionality and respond to security reports promptly; the plugin collects no conversation data beyond what its tools need and sends none to undeclared destinations. All four are true — see "What the plugin runs, reads, writes and sends" in the README.

If the portal shows the connector-style list of seven acknowledgements (directory guidelines, first-party API usage, financial transactions, AI media generation, prompt injection, conversation data collection, public documentation): all seven hold — no third-party API, no financial transactions, no media generation, tool descriptions describe only what each tool does, conversation data is stored locally at the user's request only, and the documentation is public in the repository.

## Review and submit step

- **How new versions reach the directory:** keep **GitHub push webhook** (needs admin on the repository to set up), or **Scheduled check only**.
- **Auto-publish passing versions:** on, so later versions go live by themselves once the first has been published by a reviewer.
- Raise `version` in `plugin.json`, `package.json` and `server/server.js` with every release, and add a `CHANGELOG.md` entry.

## Instructions for the reviewer (paste into "Test & launch" / notes)

> Tua is a local MCP server; there is no account, no login and no test credentials. To run it:
>
> 1. Node.js 22.15 or newer. Install the plugin from the repository (`claude plugin marketplace add github:tuacircles/tua-plugin && claude plugin install tua@tua-lokal`) or run `claude --plugin-dir .` in a checkout; dependencies install from `package-lock.json`.
> 2. On the first tool call Tua asks where the archive should live. Choose **Lokalt** (`~/Tua`). A welcome atom is written there.
> 3. Say, in Norwegian or English: "lagre dette til Tua: <any text>" → `tua_save`. Then "hva har jeg om <a word from it>" → `tua_search` (answers with the ingress), "hent sammendraget" → `tua_get(level=M)`, "hva har jeg i Tua" → `tua_list`, "gjør det synlig i prosjekt Test" → `tua_link`, then `tua_unlink`, "lag et notat av disse" → `tua_compose`. In Claude Desktop: "vis det som kort" → `tua_card` (MCP App) with the "Open in …" buttons calling `tua_open`. `tua_import(kilde=alt, dryRun=true)` shows what local history exists without writing anything; `tua_setup` without arguments shows the archive location.
> 4. Everything written is in `~/Tua/` as markdown files; delete the folder and `~/.tua/config.json` to reset. Automated check of all eleven tools: `node server/test-tools.mjs` (uses a temp folder, never a real archive).
>
> The complete list of what the plugin runs, reads, writes and sends is in README.md ("What the plugin runs, reads, writes and sends"); the privacy policy is in README.md and PRIVACY.md.

## Checklist before you press Submit

- [ ] Repository public (or private with the Claude GitHub App installed for scanning; must be public before publishing)
- [ ] `git ls-files | grep -ci "ds_store\|thumbs.db"` → 0; no `node_modules/`, `server/data/`, `dist/` committed
- [ ] `claude plugin validate --strict` on a copy without `marketplace.json` → ✔
- [ ] `node server/test-tools.mjs` and `node server/test-platform.mjs` → all green
- [ ] `tech@tuacircles.com` exists and is monitored
- [ ] Privacy policy reachable over HTTPS at the URL you enter
- [x] Icon PNG ready (`icon.png`)
- [ ] Owner/URL `tuacircles/tua-plugin` matches the real repository everywhere (grep for it)
