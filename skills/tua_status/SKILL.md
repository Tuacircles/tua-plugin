---
name: tua_status
description: Vis hva Tua har fanget og hva som står igjen — atomer per prosjekt, hva som ligger utenfor Tua (Code-økter, Cowork-økter, Desktop-samtaler, dokumenter, Innboks), om den automatiske fangsten har lagret noe nylig, og om repoet du står i speiles. Bare lesing, ingenting skrives eller importeres. Bruk ved «/tua_status», «hva har Tua fanget», «er alt med i Tua», «virker automatikken», «status for Tua», «hva mangler i Tua».
---

# tua_status — hva er fanget, hva mangler

Fire lesninger, fire linjer, ett råd. **Skriver aldri** — ingen import, ingen oppsett, ingen L-utlevering.

## 1 · Arkivet

    tua_list(limit=5)

Ta med: antall atomer, de største prosjektene (3–5), og linja «N mangler/utdatert S · N mangler/utdatert M».

## 2 · Utenfor Tua

    node "${CLAUDE_PLUGIN_ROOT}/server/import.js" --tall

Skriver JSON (`code`, `cowork`, `desktopNew`, `dokumenter`, `innboks`) og setningen «Jeg fant …» eller «Ingenting nytt å ta med.»
Første gang kan det ta 1–12 sekunder (Desktop-cachen er stor). Tallene er det som *ikke* er i Tua ennå.

## 3 · Automatikken i Claude Code

Arkivmappa er den serveren meldte ved start («[tua] MCP-server klar · arkiv: …»), eller:

    node --input-type=module -e 'const m = await import(process.argv[1]); console.log(m.FILES_ROOT)' -- "file://${CLAUDE_PLUGIN_ROOT}/server/store.js"

Les de siste linjene i `<arkiv>/.tua/hooks.jsonl` (én JSON per linje: `at`, `mode`, `status`). Finn siste linje med
`mode` = `svar`, `fil` eller `okt` og `status` ≠ `uendret` → «siste automatiske lagring: <dato kl. tid> (<mode>)».
Finnes ingen slik linje de siste 7 dagene selv om økter har kjørt: si at «Automatisk fangst» trolig er slått av i plugin-innstillingene.

## 4 · Dette repoet

Står brukeren i et git-repo: finnes `.tua-sync.json` i repo-rota, og inneholder `.git/hooks/post-commit` teksten `sync-tua`?
→ «speiles til Tua som <project>» eller «speiles ikke — `/tua_auto` setter det opp». Utenfor et repo: utelat linja.

## Svaret

En liten tabell med fire rader — Arkivet · Utenfor Tua · Automatikk i Code · Dette repoet — og deretter **ett** råd,
det som gir mest: `/tua_start` (aldri importert), `tua_import(kilde=<den største kilden>)` (noe står igjen),
`/tua_auto` (repoet speiles ikke), eller «Ny gjennomgang» (`node "${CLAUDE_PLUGIN_ROOT}/server/review.js"`) når mange atomer mangler M.
Er alt grønt: si det i én setning og ingenting mer.
