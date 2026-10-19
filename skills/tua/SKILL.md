---
name: tua
description: Lagre AI-output som atomer i Tua-arkivet med automatisk proveniens og ingress/sammendrag (S/M), hent tidligere arbeid inn i samtalen på riktig nivå, gi oversikt, og styr synlighet og nivå mellom prosjekter. Bruk når brukeren sier «lagre (dette) til Tua», «lagre som atom», «/tua»; spør «hva har jeg om X», «finn det jeg lagde om X», «har vi noe om X fra før»; vil ha oversikt («hva har jeg i Tua», «list alt», «hvilke tagger finnes», «hva mangler sammendrag»); eller vil gjøre noe synlig i et annet prosjekt («gjør dette synlig i X», «prosjekt X trenger dette», «X skal bare se ingressen»).
---

# Tua — lagre og gjenfinne via MCP

Tua er brukerens ene arkiv for AI-arbeid, på tvers av alle prosjekter. Verktøyene
`tua_save`, `tua_search`, `tua_get`, `tua_list`, `tua_link`, `tua_unlink`, `tua_compose`, `tua_card`, `tua_setup`, `tua_import` kommer fra MCP-serveren `tua`.
Prinsipp: **innhold er atomet, proveniens festes automatisk, det finnes ingen mappe.**
**Arkiv først:** før du svarer fra hukommelsen på noe som kan finnes fra før, kall `tua_search`. **Tilby, ikke skriv:** spør én gang før du lagrer.

## Første gang (oppsett og onboarding) — M14

Finnes ikke noe arkiv, **gjetter Tua ikke** hvor det skal ligge. Første verktøykall gir enten et skjema til brukeren (Code)
eller en linje som begynner med `oppsett:` — da spør du brukeren én gang hvor arkivet skal ligge (iCloud Drive, Dropbox,
OneDrive, Google Drive eller lokalt — bare de som finnes på maskinen nevnes) og kaller `tua_setup(sted=…)` når hen har valgt.
Deretter gjør du det brukeren egentlig ba om. Valget kan endres senere (`tua_setup` uten argumenter viser steder og valg).

Så lenge brukeren ikke har lagret noe, slutter verktøysvarene med en linje som begynner med `onboarding:` — følg den,
etter at du har svart på det brukeren ba om: vis mappa, velg én ting fra samtalen og spør én gang om å lagre den,
og si etterpå at den kan finnes igjen fra et annet prosjekt. Ikke foreslå mapper, tagger eller oppsett. Linja forsvinner
av seg selv etter første lagring.

## «Ta med historikken» — alt som finnes lokalt blir atomer, uten eksport (M14 + M17)

Prinsipp: **fang lokalt der det finnes, be brukeren om én handling der det ikke finnes, omgå aldri vilkår** (Tua kaller aldri
claude.ai sitt interne API, bruker ingen cookies, ingen nettleserutvidelse). Sier brukeren «ta med historikken», «importer
samtalene mine», eller svarer ja på «Jeg fant N Code-økter, N Cowork-økter, N Desktop-samtaler, N dokumenter — vil du ta dem med?»:
kall `tua_import(kilde=alt, dryRun=true)` først og vis tallene, så `tua_import(kilde=alt)` når brukeren sier ja. Kildene:

- **Claude Code-økter** (`kilde=code`): `~/.claude/projects`, komplett. Én atom per økt + substansielle svar og dokumenter som egne atomer, koblet til økta.
- **Cowork-økter** (`kilde=cowork`): Claude Desktops lokale agent-modus, `audit.jsonl` per økt. Prosjektet er mappa brukeren valgte i Cowork. Kan være hundrevis av atomer — vis tallene.
- **Desktop-samtaler** (`kilde=desktop`): alt brukeren har **åpnet i Claude Desktop** ligger i appens egen cache på disk — hele samtaler med prosjekt, verktøykall-markører, filer Claude skrev (create_file) og vedlegg, pluss prosjektkunnskap og artifacts. Leses ved serverstart og hvert 10. minutt av seg selv; `kilde=desktop` kjører det nå. Samme nøkkel som eksporten (`samtale:<uuid>`) → ingen duplikater; en samtale fra eksporten flyttes til prosjektmappa når cachen kjenner prosjektet. Grense: bare det som har vært åpnet i Desktop, slik det så ut sist.
- **Dokumenter** (`kilde=finder`): filer i Nedlastinger/Dokumenter/Skrivebord med AI-opphav (Spotlight-feltet «hvor fra» peker på chatgpt.com, claude.ai, …) eller identisk innhold med noe Claude har skrevet (sha256). Atomet er en **peker** med `file`-lenke — fila kopieres, flyttes eller endres aldri. Filer i git-repoer tas ikke (Claude Codes domene).
- **Delte lenker** (`kilde=lenke, lenke=…`): limer brukeren inn en `claude.ai/share/<id>` («Del» i Claude, også fra mobil), hentes den offentlige siden uten innlogging. Slik siden er nå, er den et skall uten samtalen; atomet blir en peker, og innholdet fylles når brukeren **åpner lenken i Claude Desktop** (da fanger cache-leseren den). Si det. Krever siden innlogging: si det, omgå ikke. Lenker kan også legges i Innboks som `.url`/`.webloc`/`.txt` (f.eks. «Lagre i Filer» fra mobil til iCloud/Dropbox-mappa Tua/Innboks).
- **Innboks** (`kilde=innboks`): eksporten fra claude.ai (Settings › Privacy › Export data → manifest + én zip per kategori, lenker som utløper etter 24 t) eller ChatGPT (Settings › Data controls › Export). Fallback, ikke hovedvei. Samtaler, prosjektdokumenter, design-samtaler og Claudes minne (`kind: minne`) blir atomer.
- **Samtaler som bare finnes på claude.ai web/mobil** og aldri er åpnet i Desktop, finnes ikke lokalt. Si det ærlig, og gi de tre veiene: åpne dem i Desktop, lag en delt lenke, eller eksport → Innboks.
- Får du en påminnelse fra Tua ved øktstart («N Code-økter er ikke tatt med», «N Desktop-samtaler i cachen», «fil venter i Innboks»):
  nevn det i én setning når det passer, og kjør ingenting uten at brukeren sier ja.
- Les aldri en eksport, øktfil eller cache-fil inn i samtalen. Importerte samtaler har ikke M før en «Ny gjennomgang» (`tua_list needs=M`).
  Rapportene ligger som atomer i prosjekt «Tua». Alt kan slettes igjen i Finder.

## S / M / L — avis-logikken

Hvert atom har tre nivåer. **S** = ingressen (≤ 300 tegn), **M** = sammendraget (150–400 ord), **L** = alt.
S og M er *mengde*, ikke redaksjon: de utelater, de omskriver ikke. Navn og tall som står i L kan stå i S/M.
Fire ting forsvinner aldri i S: konklusjonen, tallene som bærer den (beløp, datoer, prosent), status
(gjeldende/historisk/erstattet) og proveniens (dato, versjon). `summary` er noe annet: *hvorfor*-linjen,
og lever ved siden av S.

## Når brukeren vil lagre («lagre dette til Tua», «lagre som atom»)

Kall `tua_save` én gang per ting som skal lagres:

- `content`: **hele** innholdet av det som nettopp ble laget (dokument, kode, analyse) — aldri et sammendrag av det. Dette er L.
- `short`: **alltid.** Ingressen, 1–3 setninger, maks 300 tegn — skriv den selv, nå, mens du vet hva som ble bestemt.
- `medium`: når innholdet er over ~3 000 tegn. 150–400 ord: beslutninger, tall, korreksjoner, åpne punkter, struktur. Ikke transkript.
- `summary`: én setning med *hvorfor*: hva ble bestemt, eller hvorfor ser det slik ut.
- `name`: utelat; første linje/overskrift blir tittel. Sett bare hvis innholdet mangler en god første linje.
- `project`: **Claude-prosjektets navn** — i Code: repo-mappen/sidefelt-navnet (eller `project` i `.tua-sync.json` hvis den finnes); i Desktop: Project-navnet. Bruk brukerens eget navn hvis det sies eksplisitt.
- `key`: for levende ting som skal oppdateres (statusnotat, manifest, lenker) — samme key neste gang = erstatt, ikke duplikat. Send ny `short`/`medium` når du oppdaterer, ellers blir de merket utdaterte.
- `convo`: 3–8 ord som beskriver denne samtalen/oppgaven — pekeren tilbake til konteksten.
- `tags`: 1–4 korte ord.
- `links`: bare det som er spesifikt for atomet — fila du nettopp skrev det til (`{kind: "file", href: "<absolutt sti>"}`),
  en nettadresse (`url`). Repo og Desktop-prosjekt for prosjektet legges til automatisk fra prosjektregisteret; ikke send dem.

Spør **aldri** hvilken mappe det skal i. Bekreft kort med tittel, prosjekt og at proveniens og ingress er festet.
Hvis brukeren sier «lagre alt vi har laget», lagre hvert leverbart stykke som eget atom.

## Når brukeren leter («hva har jeg om X», «har vi noe om X fra før»)

1. Kall `tua_search` **først**, med brukerens nøkkelord. Utelat `project` så søket går på tvers av alle prosjekter.
2. Treffene kommer med S (ingressen) og hvorfor-linjen. Ofte er det nok til å svare — da svarer du fra S.
3. Trengs mer: `tua_get` med `level=M` først. Hent `level=L` (alt) bare når svaret faktisk krever hele innholdet
   (sitater, detaljer, redigering). Et 15 000-tegns manifest inn i samtalen for ett enkelt spørsmål er sløsing.
4. Svaret fra `tua_get` har «Åpne i Claude: claude://…», «Fil: …» og «Repo (Code): …» (M9) — gjengi dem når brukeren
   vil åpne atomet et sted; `claude://`-lenken åpner Desktop-prosjektet atomet hører til.
5. Står det «(ingress fra v3, innhold er v5)», er nivået utdatert. Nevn det — og tilby å skrive ny S/M
   (`tua_save` med samme `key`, eller si det til brukeren).
6. Hvis ingen treff: si det, og tilby å lagre det som lages nå.

## Når brukeren vil ha oversikt («hva har jeg i Tua», «list alt», «hvilke tagger finnes», «vis alle filer»)

Kall `tua_list` uten filtre. Den gir prosjekter med antall, tagger med antall, hvor mange som mangler S/M,
og de nyeste atomene. Presentér det som en kort oversikt — prosjekter og tagger først, så lista.
- «vis alt i prosjekt X» → `tua_list` med `project`.
- «vis alt med tag Y» → `tua_list` med `tag`.
- «hva mangler sammendrag / ingress» → `tua_list` med `needs=S` eller `needs=M`.
- Er det flere atomer enn lista viser, si det og tilby å øke `limit` eller filtrere.
Et «file» i Tua er et atom — bruk ordet brukeren bruker, men det er samme ting.

## Ny gjennomgang («fyll inn sammendragene», «lag ingress på det som mangler»)

`tua_list needs=S` (eller `M`) gir lista. For hvert atom: hent L, skriv S (og M når L > 3 000 tegn),
og fest dem med `tua_save` med samme `key` og `project` hvis atomet har key — ellers be brukeren kjøre
`node tua-plugin/server/review.js --apply <fil.json>` med `[{id, short, medium}]`. Menneskeskrevne nivåer rører du ikke.

## Når brukeren vil lage noe AV atomer («lag et styrenotat av disse», «sett sammen X, Y og Z») — M10

1. Finn kildene med `tua_search`/`tua_list`. Kall `tua_compose` med `ids`, `name`, `level` (M som standard —
   L bare når brukeren ber om hele innholdet) og en `key` (f.eks. `lev:riulf-styrenotat`) så neste kjøring erstatter.
2. Du får markdown-kilden tilbake, lagret som et **leveranse-atom** med `bygget_av` (hvilken versjon av hver kilde,
   på hvilket nivå). Skriv den om i husstilen om det trengs og lagre med `tua_save(key=samme key, content=…)`.
3. Rendrer du html/pdf (`build/html2pdf.sh`): fest dem med `tua_save(key=…, renders=[{path: "<absolutt sti>"}])`.
   Fila er en gjengivelse — atomet er sannheten. Står det «⚠ endret utenfor Tua» senere, er fila redigert i et annet verktøy.
4. Står det «bygger på utdaterte kilder» (en kilde har gått videre, v2 → v4): si det, og tilby å kjøre `tua_compose`
   på nytt med samme key.

Tre regler (V15): **Vault** — et atom tagget `vault` går aldri ut over S, uansett hva som bes om; si det i stedet for
å omgå det. **Utlevering logges** — hver `tua_get`/`tua_compose` skrives til `.tua/utlevering.jsonl` (bare metadata);
hent derfor ikke L «for sikkerhets skyld». **Redigert utenfor Tua** — står det «redigert utenfor Tua → v5», er fila
endret i Finder/annen editor; det er en ny versjon, aldri en fletting, og S/M er da utdaterte.

## Når brukeren vil gjøre noe synlig i et annet prosjekt («gjør dette synlig i X», «prosjekt X trenger dette»)

Kall `tua_link` med atomets id og prosjektnavnet. Det lager en **referanse** — atomet finnes fortsatt én gang,
i prosjektet det oppsto i. Si det eksplisitt: «synlig i X nå — som referanse, ikke kopi».
- Nivå: standard er L (alt) for brukerens egne prosjekter (V11). Sier brukeren «X skal bare se ingressen /
  sammendraget», send `level=S` eller `level=M`. Kall `tua_link` igjen med nytt `level` for å løfte eller senke.
- Når mottakeren er en *annen person*, foreslå S som utgangspunkt og la brukeren løfte bevisst.
- `tua_unlink` fjerner synligheten igjen.

Om `context` i søk og henting: **standard er å søke i alt** — brukeren eier hele arkivet.
Bruk `context=X` bare når brukeren eksplisitt spør «hva ser prosjekt X?» / «hva har prosjekt X tilgang til?».
Da får du aldri mer enn nivået X har fått; atomer som er referert inn vises med «(referert inn, nivå S)».

## Når brukeren vil *se* et atom eller treff som kort («vis som kort», «vis meg det jeg har om X») — M13

- `tua_card(query=…)` viser en treffliste som kort inne i samtalen (Claude Desktop/web): ingress per treff, «Les M» rett i lista.
- `tua_card(id=…)` viser ett atom som kort: S først, knapper for M og L, «Bygget av», «Synlig for», relaterte og «Åpne i …».
- Bruk `tua_search`/`tua_get` når *du* trenger teksten; bruk `tua_card` når *brukeren* skal se og klikke. I Claude Code finnes ikke kort — der svarer `tua_card` med tekst; foretrekk `tua_search`/`tua_get` der.
- Kortet melder tilbake hva brukeren åpnet («brukeren åpnet M av …») — bygg videre på det, ikke hent det samme på nytt.

## Proaktivt

Når du nettopp har levert noe brukeren sannsynligvis vil finne igjen senere (en spec, en analyse, en beslutning),
tilby i én linje: «Vil du at jeg lagrer dette til Tua?» — ikke lagre uten at brukeren sier ja.
