---
name: tua_start
description: Kom i gang med Tua i ett grep — ta med all historikk (Code-økter, Cowork-økter, Desktop-samtaler, dokumenter med AI-opphav, Innboks) og slå på alt som fanger fremover (automatisk lagring i hver Code-økt, Desktop-cachen, speiling av repoet du står i). Bruk ved «/tua_start», «ta med alt», «sett opp Tua», «last inn alle økter», «fang alt fremover», «kom i gang med Tua», eller i første økt etter at pluginen er installert.
---

# tua_start — ta med alt, og hold det på

Én kommando for det brukeren egentlig vil første gang: **alt som finnes skal inn, og alt som kommer skal fanges.**
Alt leses lokalt, uten eksport og uten innlogging. Ingenting skrives før brukeren har sagt ja én gang (oppsettet).
Kan kjøres igjen når som helst — importen er idempotent, oppsettet hopper over det som alt er gjort.

## 0 · Arkivet

Er arkivet ikke valgt ennå, spør det første verktøykallet hvor det skal ligge (`tua_setup`). Gjett aldri; vent på svaret før du går videre.

## 1 · Historikken (leses av seg selv fra 0.5.17)

Når arkivet er valgt, leser Tua det som ligger på maskinen uten et eget ja — Code-økter, Cowork-økter, Codex-samtaler,
Desktop-samtaler og dokumenter med AI-opphav — og holder det ved like omtrent en gang i timen. Sjekk tilstanden:

    tua_setup()

Står «Automatisk lesing … på»: vis kortet «Dette fant jeg» om det ikke alt er vist (`tua_search(query="Dette fant jeg", project="Tua")`,
så `tua_card(id=…, level="M")`), og gå til trinn 3. Står den «av»: spør én gang om brukeren vil slå den på (`tua_setup(historikk=true)`)
eller bare ta med alt nå.

## 2 · Importen for hånd (når lesingen er av, eller brukeren vil ha alt nå)

    tua_import(kilde=alt, dryRun=true)

Vis tallene, spør **én gang** «Ta med alt?», og kjør så `tua_import(kilde=alt)`. Bare deler: `kilde=code|cowork|codex|desktop|finder|innboks`
eller `etter=ÅÅÅÅ-MM-DD`. Samtaler som bare finnes på claude.ai web/mobil blir ikke med: be brukeren åpne dem i Claude Desktop
(så fanges de av seg selv) eller lime inn en delt lenke (`kilde=lenke`).

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

- Spør én gang, ikke per kilde. Importen for hånd kjøres aldri uten ja; den automatiske lesingen har fått sitt ja i oppsettet og slås av med `tua_setup(historikk=false)`.
- Tua sletter aldri noe; alt kan fjernes igjen i Finder.
- I Claude Desktop uten repo: trinn 0–2, og si at hooks bare finnes i Claude Code.
- Ikke les eksporter eller økter inn i samtalen — tallene og rapportlinjene er nok.
