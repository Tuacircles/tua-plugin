---
name: tua_start
description: Kom i gang med Tua i ett grep — ta med all historikk (Code-økter, Cowork-økter, Desktop-samtaler, dokumenter med AI-opphav, Innboks) og slå på alt som fanger fremover (automatisk lagring i hver Code-økt, Desktop-cachen, speiling av repoet du står i). Bruk ved «/tua_start», «ta med alt», «sett opp Tua», «last inn alle økter», «fang alt fremover», «kom i gang med Tua», eller i første økt etter at pluginen er installert.
---

# tua_start — ta med alt, og hold det på

Én kommando for det brukeren egentlig vil første gang: **alt som finnes skal inn, og alt som kommer skal fanges.**
Alt leses lokalt, uten eksport og uten innlogging. Ingenting skrives før brukeren har sagt ja én gang.
Kan kjøres igjen når som helst — importen er idempotent, oppsettet hopper over det som alt er gjort.

## 0 · Arkivet

Er arkivet ikke valgt ennå, spør det første verktøykallet hvor det skal ligge (`tua_setup`). Gjett aldri; vent på svaret før du går videre.

## 1 · Omfanget (ingenting skrives)

    tua_import(kilde=alt, dryRun=true)

Vis tallene slik de kommer: N Code-økter, N Cowork-økter, N Desktop-samtaler, N dokumenter, N filer i Innboks.
Spør **én gang**: «Ta med alt?» Vil brukeren bare ha deler, bruk `kilde=code|cowork|desktop|finder|innboks` eller `etter=ÅÅÅÅ-MM-DD`.

## 2 · Importen

    tua_import(kilde=alt)

Si på forhånd at det kan ta noen minutter ved mye historikk. Rapportér én linje per kilde («N nye · N oppdatert · N uendret»)
og at rapportene ligger som atomer i prosjekt «Tua». Samtaler som bare finnes på claude.ai web/mobil blir ikke med:
be brukeren åpne dem i Claude Desktop (så fanges de av seg selv) eller lime inn en delt lenke (`kilde=lenke`).

## 3 · Fremover — tre flater, én linje hver

- **Claude Code:** pluginens hooks fanger allerede lange svar, tekstdokumenter du skriver og et økt-sammendrag i *hver* økt,
  i alle prosjekter, så lenge pluginen er på og innstillingen «Automatisk fangst» står på (standard). Ingenting å gjøre;
  si hvor det slås av (plugin-innstillingen).
- **Claude Desktop:** cache-vakten leser nye samtaler hvert 10. minutt så lenge Tua-serveren kjører. Ingenting å gjøre.
- **Repoet du står i:** finnes `.git` og mangler `.tua-sync.json`, sett opp speiling nå — samme kommando og navneregel som `/tua_auto`:

      node "${CLAUDE_PLUGIN_ROOT}/server/sync-tua.js" --project "<repo-mappens navn>" --install-hook

  Spør om navnet bare hvis det er genuint tvetydig. Finnes `.tua-sync.json` fra før: si «speiles allerede», gjør ingenting.
  Er det ikke et git-repo (f.eks. et Desktop-prosjekt uten kode): si det, og hopp over.

## 4 · Kvitteringen

Ett kort avsnitt: hva som ble tatt med (tallene), hva som nå er på, og én setning til slutt:
«Fra nå havner det du gjør i Claude Code og Desktop i Tua av seg selv. `/tua_status` viser hva som er fanget.»

## Regler

- Spør én gang, ikke per kilde. Kjør aldri importen uten ja.
- Tua sletter aldri noe; alt kan fjernes igjen i Finder.
- I Claude Desktop uten repo: trinn 0–2, og si at hooks bare finnes i Claude Code.
- Ikke les eksporter eller økter inn i samtalen — tallene og rapportlinjene er nok.
