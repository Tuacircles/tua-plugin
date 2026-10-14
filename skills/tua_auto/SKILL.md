---
name: tua_auto
description: Sett opp og kjør automatisk speiling av det prosjektet du står i inn i Tua — commits, manifest, beslutningslogg, lenker og PDF-dokumenter — med Claude-prosjektets navn som standard, der nye versjoner erstatter gamle. Bruk ved «/tua_auto», «speil dette prosjektet til Tua», «sett opp tua-sync her», «lagre alt til Tua automatisk», eller første gang det jobbes i et repo som ikke har .tua-sync.json.
---

# tua_auto — prosjektet speiler seg selv inn i Tua

Alt som dokumenterer et prosjekt skal ligge i Tua under **prosjektets eget navn**, og nye versjoner
skal **erstatte** gamle (aldri duplikater). Verktøyet følger med pluginen:

    ${CLAUDE_PLUGIN_ROOT}/server/sync-tua.js

Det speiler: commit-logg · manifest (CLAUDE.md / MANIFEST.md / README.md) · beslutningslogg
(concepts/00-beslutninger.md, BESLUTNINGER.md, docs/beslutninger.md) · lenker · alle HTML-dokumenter som
har en PDF ved siden av seg. Hver ting har en stabil `key`; samme key = erstatt (id og synlighet beholdes, versjon +1).

## Prosjektnavn — standard er Claude-prosjektets navn

1. I **Claude Code**: navnet på repo-mappen / prosjektet slik det vises i sidefeltet.
2. I **Claude Desktop / Projects**: Project-navnet brukeren står i.
3. Finnes `.tua-sync.json` i repoet, gjelder `project` derfra.

Spør bare hvis navnet er genuint tvetydig. Ellers: bruk det, og si hvilket du brukte.

## Første gang i et repo (oppsett)

Kjør fra repo-roten, med prosjektnavnet:

    node "${CLAUDE_PLUGIN_ROOT}/server/sync-tua.js" --project "<Navn>" --install-hook

Det (1) lagrer navnet i `.tua-sync.json`, (2) installerer `.git/hooks/post-commit` som kjører sync etter hver commit,
og (3) gjør første speiling. Rapportér sammendragslinja («N nye · N oppdatert · N uendret»).
Hooken ligger i `.git/hooks/` (ikke versjonert) — på ny maskin/klone kjøres samme kommando igjen.
Har prosjektet et Claude Desktop-prosjekt: `--claude-project <uuid eller claude.ai/project/…-adresse>` gir «Åpne i Claude» på alle atomene.

## Deretter — ingenting

Hver commit kjører sync automatisk; `[tua-sync] …` i commit-utskriften er kvitteringen.
Kjør manuelt ved behov: `node "${CLAUDE_PLUGIN_ROOT}/server/sync-tua.js"`

## Samme standard for ad hoc-lagring

Når brukeren sier «lagre dette til Tua» i et prosjekt, bruk **samme prosjektnavn** som `project` i `tua_save`.
Levende ting (statusnotat, manifest, lenkeliste) lagres med `key`, så neste lagring erstatter.
Et nytt dokument fanges opp av sync først når det har en PDF ved siden av seg.

## Uten git-repo (f.eks. et Desktop-Project uten kode)

Da finnes ingen hook. Speil manuelt med `tua_save` + `key` (manifest, lenker, beslutninger), `project` = Project-navnet.

## Pluginens egne hooks (Claude Code)

Pluginen lagrer i tillegg automatisk, uten sync: lange svar (Stop), tekstdokumenter du skriver (Write/Edit på .md/.txt)
og et økt-sammendrag (PreCompact/SessionEnd) — alle merket `auto`. Slås av med innstillingen «Automatisk fangst».
