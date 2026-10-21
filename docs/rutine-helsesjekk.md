# Tua-helsesjekk — nattlig rutine, i klartekst (v0.1, 21.10.2026)

> Dette er *instruksen* — laget som bestemmer hva rutinen gjør. Koden kommer etterpå og skal gjøre nøyaktig dette, ikke mer.
> Tre lag: **koden** (fast, i git, med tester) · **instruksen** (denne fila; rutinen kan foreslå endringer, Erik godkjenner) ·
> **minnet** (ett atom i Tua som rutinen leser først og oppdaterer sist). Det er minnet som lærer.

## Hvorfor

20.10.2026 oppdaget vi at Desktop-leseren hadde vært blind i fem uker uten at noen merket det, at Desktop-serveren hadde
krasjet hvert 30. sekund siden kvelden før, og at søket var forurenset av Tuas egne testsamtaler. Alt dette sto i logger
som ingen leste. Helsesjekken leser dem hver natt, sjekker at det som feilet i går virker i dag, og sier fra om morgenen.

## Når og hvor

- **Hver natt kl. 03:30** på Mac-en (launchd). Tar under to minutter. Krever at maskinen er våken; sover den, kjøres
  sjekken ved neste oppvåkning (launchd gjør det selv).
- Kjører lokalt, uten nettverk, uten innlogging. Leser logger og arkivet; skriver **bare** én rapport og sitt eget minne.

## Regler som aldri brytes

1. Sletter, flytter eller endrer **aldri** et atom. Rydding er alltid et *forslag* i rapporten.
2. Endrer aldri config (Desktop, plugin, hooks). Kjører aldri en import som skriver.
3. Ingen nettverk. Ingen cookies. Ingen kall mot claude.ai.
4. Tester kjøres bare mot et scratch-arkiv (som `test-tools.mjs` og `test-desktop-store.mjs` alt gjør).
5. Feiler sjekken selv, skrives *det* som rapport («Helsesjekken feilet: …») — stillhet er aldri et svar.

## Steg 1 — les minnet

Åpne atomet **«Helsesjekk — minne»** i prosjektet **Tua**. Der står: kjente feil med dato, hva som var rødt i går og skal
sjekkes spesielt i dag, terskler som er justert, og forslag som venter på Erik. Finnes ikke atomet, lages det med
startinnholdet nederst i denne fila.

## Steg 2 — samle dagens feilmeldinger (siste 24 timer)

| Kilde | Hva | Hva som teller som feil |
|---|---|---|
| `~/Library/Logs/Claude/mcp-server-tua.log` | Desktop-serveren (Desktop-chat og Cowork via brua) | linjer med `[error]`, «Cannot find module», «Server disconnected», «Couldn't start», «Connection closed»; **antall og første/siste tidspunkt** |
| `~/Library/Logs/Claude/main.log` | Desktops hovedlogg | «localMcpBridge … tua» uten «announcing», «dropping server», «config references plugin user configuration» |
| `~/Library/Caches/claude-cli-nodejs/*/mcp-logs-tua/*.jsonl` | Code-øktenes MCP-logg | poster med `error`, «Skipping connection», «recent failure cached» |
| `<arkiv>/.tua/hooks.jsonl` | Stop-, fil-, økt- og SessionStart-hooken | poster med `error`; **tellinger** per `skipped`-grunn (kort, data-dump, tua-ekko, filtype/sti) og per `status` (ny, oppdatert, uendret) |
| `<arkiv>/.tua/import-state.json` | siste importer | `at` eldre enn 2 dager for desktop når Desktop er i bruk |
| `<arkiv>/.tua/utlevering.jsonl` | utleveringer (L) | bare telles — ingen innhold leses |
| git-loggen i repoet | post-commit-speilingen | commits siste døgn uten tilsvarende «[tua-sync]»-atom i Tua_tua |

Hver feil får én linje: kilde · første gang · antall · siste melding (maks 120 tegn).

## Steg 3 — sjekk at det som feilet før, virker nå (regresjonslista)

Lista starter med feilene fra 20.10. Minnet legger til nye etter hvert. Hver sjekk svarer **grønn / gul / rød** med én
linje bevis.

| # | Sjekk | Grønn når | Fra |
|---|---|---|---|
| R1 | Desktop-configen peker på en fil som finnes | `claude_desktop_config.json` → `mcpServers.tua.args[0]` finnes på disk | 20.10 (pekte på flyttet `tua-mcp/server.js`) |
| R2 | Serveren starter og svarer | bundelen svarer på `initialize` innen 5 s mot scratch-arkiv, `serverInfo.version` = versjonen i `plugin.json` | 20.10 (krasjet uten node_modules) |
| R3 | Desktop-leseren ser nye samtaler | `desktopStaleness()` → ikke stille; nyeste importerte samtale < 2 dager når Desktop er brukt siste døgn | 20.10 (blind siden 15.09) |
| R4 | Samtalelageret lar seg lese | `test-idb.mjs` → > 0 samtaler, 0 feil, 0 poster hoppet over | 20.10 |
| R5 | Tua-prat holdes ute | `test-tuaprat.mjs` grønn **og** ingen atomer siste døgn med tittel/første melding som starter med `/tua` eller «N treff på «» | 20.10 |
| R6 | Kortet finnes | ressursen `ui://tua/kort` svarer (del av `test-tools.mjs`) | 20.10 (vises ikke i Cowork — kjent, ikke rød) |
| R7 | Pluginen er i takt | versjon i `~/.claude/plugins/cache/tua-lokal/tua/<nyeste>` = `plugin.json` i repoet; bundelen ikke eldre enn `server/*.js` | 20.10 |
| R8 | Vaktene lever | hooks.jsonl har minst én post siste 24 t hvis Code er brukt; import-state `desktop.at` < 1 time hvis Desktop-serveren kjører | 20.10 |

Rød = sjekken var grønn i går og er rød i dag, **eller** en ny feilmelding har kommet ≥ 3 ganger siste døgn.
Gul = avvik som kan forklares (Desktop ikke brukt, maskinen sov) — nevnes, men vekker ingen.

## Steg 4 — arkivets tilstand

Tall, ikke dommer: antall atomer totalt og nye siste døgn per prosjekt · atomer uten S · «---»-titler · mulige
dobbeltimporter (samme tittel og samme første 500 tegn i to prosjekter) · Dropbox-konfliktfiler («conflicted copy») ·
en `.lock` eldre enn 10 minutter · avvik mellom `index.json` og filene på disk · størrelsen på `hooks.jsonl` (rotér-forslag over 5 MB).
Alt som bør ryddes, listes som **forslag med sti** — aldri utført.

## Steg 5 — skriv rapporten

Ett atom per natt: **«Helsesjekk 2026-10-22»** i prosjektet **Tua**, kind `capture`, tagger `helsesjekk`, `auto`.
- **S (ingressen, én linje):** «Grønn 8/8 · 0 feil i loggene · 12 nye atomer · 2 ryddeforslag» — eller «RØD: R3 Desktop-leseren stille i 3 dager».
- **Innhold:** regresjonslista med bevis · feilmeldinger samlet · arkivtall · ryddeforslag · «siden i går» (hva som endret seg).
- Rapporten erstatter ikke gårsdagens; de blir en tidsserie man kan lese bakover.

## Steg 6 — oppdater minnet

Atomet «Helsesjekk — minne» får ny versjon med: dagens røde og gule · hva som skal sjekkes spesielt i morgen ·
nye feilmønstre (regex + eksempel) som bør inn i steg 2 · **forslag til endringer i denne instruksen**, merket «forslag»,
aldri utført. Minnet holdes under 3 000 tegn; eldre ting flyttes til rapporten.

## Steg 7 — si fra

- **Rød:** skriv én linje til `<arkiv>/.tua/helsesjekk-varsel.txt`. SessionStart-hooken leser fila og ber Claude si det
  høyt i første økt neste dag («Tua-helsesjekken i natt: RØD — R3 …»). Fila slettes når Erik har sett den (hooken gjør det).
- **Grønn/gul:** ingen varsel. Rapporten ligger i Tua.
- **Kortet (Erik 21.10):** resultatet presenteres som Tua-kort når det er klart. Rutinen kan ikke åpne en samtale kl. 03:30,
  så den legger igjen en lapp (`<arkiv>/.tua/helsesjekk-siste.json`); første Code-økt etterpå viser rapporten som kort
  (`tua_card id=…`) én gang, så merkes lappen som vist. I Desktop-chat: be om «helsesjekken fra i natt».
- **Sammendraget (M)** skriver rutinen selv (Erik 21.10): status, rødt/gult med bevis, feilene, tallene, forslagene, endringene.

## Slik lærer rutinen (uten å skrive om seg selv)

- En sjekk som har vært grønn **14 netter på rad** foreslås nedgradert til ukentlig. Erik sier ja eller nei.
- Et ryddeforslag som har vært **identisk tre netter på rad** foreslås automatisert (med hva den ville gjort, og hvor
  det kan angres). Erik sier ja eller nei.
- En ny feilmelding som dukker opp uten at noen sjekk fanget den, blir et forslag om ny sjekk R9, R10 …
- Alle forslag står i minnet til de er besvart. Besvarte forslag blir enten kode (med test) eller en linje i denne fila.

## Startinnhold for minne-atomet (første natt)

```
Helsesjekk — minne (opprettet 21.10.2026)
Kjente feil: R1–R8 fra 20.10 (se instruksen). Alle grønne 20.10 kveld etter 0.5.4.
Sjekk spesielt i morgen: R3 (første natt med lageret), R5 (første dag med tua-prat-regelen).
Terskler: stillhet 14 dager (R3), ny feil ≥ 3 ganger = rød.
Forslag som venter: ingen.
```

## Det som må kodes (neste steg, når instruksen er godkjent)

1. `server/helsesjekk.js` — steg 2–7 som kommandolinje: `node server/helsesjekk.js [--dry-run]`. Gjenbruker `desktopStaleness`,
   `test-idb`, `test-tuaprat`, `test-tools` og `store.js`.
2. `launchd`-plist i `~/Library/LaunchAgents/com.tuacircles.helsesjekk.plist` (03:30, `RunAtLoad` nei, `StartCalendarInterval`).
3. SessionStart-hooken leser og sletter `.tua/helsesjekk-varsel.txt`.
4. Minne-atomet opprettes første gang rutinen kjører.
