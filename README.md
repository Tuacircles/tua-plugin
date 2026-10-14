# Tua som Claude-plugin (M14)

Denne mappa er pluginen. Den pakker det som allerede finnes i repoet — ingen ny serverkode:

| Del | Hvor | Merk |
|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | navn `tua`, innstillinger `arkivmappe` (mappe) og `auto_lagring` (på/av) |
| Markedsplass | `.claude-plugin/marketplace.json` | gjør at mappa kan legges til lokalt: `/plugin marketplace add <sti>` |
| Server | `.mcp.json` → `server/server.js` | `server/` er en symlenke til `../tua-mcp` (én kilde). Cache i `${CLAUDE_PLUGIN_DATA}/data` |
| Skills | `skills/tua` (symlenke til `.claude/skills/tua`), `skills/tua_auto` | `tua_auto` bruker `${CLAUDE_PLUGIN_ROOT}/server/sync-tua.js` |
| Hooks | `hooks/hooks.json` + `hooks/tua-hook.mjs` | SessionStart → påminnelse om import (Innboks, Code-økter) · Stop → lange svar · PostToolUse Write/Edit → .md/.txt-dokumenter · PreCompact/SessionEnd → økt-sammendrag |

Første gang spør Tua hvor arkivet skal ligge (iCloud Drive, Dropbox, OneDrive, Google Drive eller lokalt) — via skjema i Code,
ellers via `tua_setup`. Innstillingen `arkivmappe` i pluginen overstyrer (`TUA_FILES_ROOT`). «Ta med historikken» = `tua_import`.

## Installere lokalt (egen maskin)

    claude plugin marketplace add ./tua-plugin
    claude plugin install tua@tua-lokal
    claude plugin details tua

Pluginen lastes **på plass** fra denne mappa (endringer gjelder fra neste økt / `/reload-plugins`).
Serveren heter da `plugin:tua:tua` i Code. Beholder du også `tua` i repoets `.mcp.json`, får Code to like servere — fjern den ene.

## Pakke for andre

    node tua-plugin/pakk.mjs

gir `dist/tua-plugin.zip` (claude.ai › Customize › Plugins › Upload, eller `claude --plugin-dir dist/tua-plugin.zip`)
og `dist/tua.mcpb` (Claude Desktop: dobbeltklikk). `dist/` er ikke versjonert. Ingenting publiseres automatisk.

## Ærlige grenser

- Chat på claude.ai (web/mobil) kjører ikke lokale servere — der virker bare skillene. Desktop trenger fortsatt `.mcpb` eller config-fila.
- Hooks finnes bare i Claude Code (og Cowork), ikke i Desktop-chat.
- Eksporten fra Claude er manuell og kan ta timer å få; plugins forutsetter betalt plan.
