# Innsending av Tua-pluginen — steg for steg

*Skrevet 19. oktober 2026 for Erik Teigen. Dette er det du gjør selv, i rekkefølge, med kommandoene ferdige. Alt som ikke krever kontoene dine er allerede gjort (se «Hva som er klart» nederst). Portal-svarene står i [SUBMISSION.md](../SUBMISSION.md); dette dokumentet sier *når* du bruker dem.*

---

## 0. Hva maskinen din har og mangler (sjekket 19.10.2026)

| Sjekk | Funn | Betydning |
|---|---|---|
| `git config credential.helper` | `osxkeychain` | Git husker GitHub-passord/token i Nøkkelring etter første push. |
| Nøkkelring-innslag for github.com | **finnes ikke** | Du har aldri pushet til GitHub fra denne maskinen. Første push ber om brukernavn og token. |
| `~/.ssh` | bare `known_hosts`, **ingen nøkler** | Bruk HTTPS, ikke SSH. Ingenting å sette opp. |
| `ssh -T git@github.com` | «Host key verification failed» | Som ventet uten SSH-oppsett. Ignorer. |
| GitHub CLI (`gh`) | ikke installert | Alt gjøres i nettleseren + vanlig `git`. |
| Remote i Tua-repoet | ingen | Repoet ditt er bare lokalt; pluginen pushes til en ny, egen URL. |
| `https://github.com/tuacircles` | **Din egen brukerkonto** (visningsnavn «Tuacircles», ingen repoer før 19.10.2026) | Repoet legges rett på kontoen din. Ingen organisasjon trengs. |

**Innlogging ved push:** GitHub godtar ikke kontopassord i Git. Når `git push` spør om *Password*, limer du inn et **Personal Access Token**. Lag det på <https://github.com/settings/tokens?type=beta> → *Generate new token* → navn «Tua plugin push», utløp 90 dager, *Repository access*: «Only select repositories» → `tua-plugin`, *Permissions → Contents: Read and write*. Kopier tokenet én gang; Nøkkelring lagrer det etter første push. Du kan trygt slette tokenet på GitHub når pushen er gjort — eller la det leve til neste versjon.

---

## 1. Eiernavn på GitHub — avgjort

**Avgjort 19.10.2026:** GitHub-brukerkontoen din heter allerede `Tuacircles` (firmaet, Tua Circles Holding AS), og repoet heter `tua-plugin` (produktet Tua). Adressen er `https://github.com/tuacircles/tua-plugin`, som alle filene peker på. Ingen organisasjon ble opprettet — GitHub avviste navnet fordi det er din konto. Ingenting skal byttes.

*Senere, om ønskelig:* kontoen kan gjøres om til en organisasjon (Settings → *Transform account into an organization*) uten at adressen endres. Ikke nødvendig for innsendingen.

---

## 2. Lag eksportgrenen på nytt fra `main`

> **Status 19.10.2026:** `tua-plugin-export` er laget fra `claude/elastic-taussig-41b833` **etter** at `claude/m18-merge` (M15 + M18) ble flettet inn der, så den inneholder `server/keychain.js` og `server/trust-scores.json`. Den er validert og klar til push (steg 4). Når `main` senere har fått de samme commitene, gir en ny split fra `main` samme historikk, og pushen blir en vanlig fast-forward. Oppskriften under er for neste gang.

Kjør i Terminal, i hovedutsjekkingen:

```bash
cd /Users/bruker/Documents/Claude/Projects/tua
```

```bash
git log --oneline -1 main
```

(Sjekk at commit-meldingen nevner M18/plugin bundle og at M15 er med. Hvis ikke: vent med resten.)

```bash
git branch -D tua-plugin-export
```

```bash
git subtree split --prefix=tua-plugin -b tua-plugin-export
```

Kontroller:

```bash
git ls-tree --name-only tua-plugin-export
```

→ skal vise `.claude-plugin`, `LICENSE`, `README.md`, `PRIVACY.md`, `package.json`, `package-lock.json`, `server`, `skills`, `hooks`, ikon-PNG-en, `docs` … i **rota**.

```bash
git ls-tree -r --name-only tua-plugin-export | grep -ci "ds_store\|node_modules\|server/data"
```

→ skal gi `0`.

```bash
git ls-tree -r --name-only tua-plugin-export | grep -c "server/keychain.js\|server/trust-scores.json"
```

→ skal gi `2` (bevis på at M15 er med). Gir den `0`, er M15 ikke flettet ennå.

---

## 3. Opprett repoet på github.com — gjort

**Gjort 19.10.2026:** <https://github.com/tuacircles/tua-plugin> finnes, er public og tomt (ingen README, .gitignore eller lisens). Oppskriften står igjen for et eventuelt nytt repo:

1. Logg inn på GitHub. Gå til <https://github.com/new>.
2. **Owner:** `tuacircles` (eller navnet fra steg 1). **Repository name:** `tua-plugin`.
3. **Description:** `Tua — the local-first archive for everything you make with AI. Claude plugin (MCP server, skills, hooks).`
4. **Public.**
5. **Ikke** huk av «Add a README file», ingen `.gitignore`, ingen license — alt dette ligger allerede i grenen. Repoet må være tomt, ellers nekter pushen.
6. *Create repository.* GitHub viser en tom side med instruksjoner — ignorer dem, bruk steg 4.

---

## 4. Push grenen til det nye repoet — gjort

**Gjort 19.10.2026:** `main` på GitHub = commit `8eee3dc` (M15 + M18 + ikon, docs, tech@), tag `v0.4.0` på samme commit. Tokenet «Tua plugin push» (bare repoet tua-plugin, Contents: Read and write, utløper 18.11.2026) ligger i Nøkkelring, så senere push spør ikke. Remoten `tua-plugin` er lagt inn i worktreen `elastic-taussig-41b833`; i hovedutsjekkingen må den legges inn én gang (kommandoen under). Oppskriften står igjen for neste versjon:

```bash
cd /Users/bruker/Documents/Claude/Projects/tua
```

```bash
git push https://github.com/tuacircles/tua-plugin.git tua-plugin-export:main
```

Terminal spør *Username* (GitHub-brukernavnet ditt) og *Password* (lim inn tokenet fra steg 0). Nøkkelring husker det.

Lagre adressen som remote så senere versjoner er én kommando:

```bash
git remote add tua-plugin https://github.com/tuacircles/tua-plugin.git
```

Valgfritt, men anbefalt — merk første versjon med en tag (portalen kan låses til tagger):

```bash
git tag v0.4.0 tua-plugin-export && git push tua-plugin v0.4.0
```

**Sjekk i nettleseren:** <https://github.com/tuacircles/tua-plugin> skal vise `README.md` rendret under fillista, med `.claude-plugin/`, `LICENSE`, `server/`, `skills/`, `hooks/` i rota. Trykk tannhjulet ved *About* → legg inn Website `https://tuacircles.com` og haker av *Releases/Packages* etter smak.

---

## 5. Opprett tech@tuacircles.com

Portalen sender alle beskjeder om vurderingen hit, og adressen står i `plugin.json`, `PRIVACY.md` og README. Den må finnes og leses **før** du sender inn.

E-posten for tuacircles.com ligger i **Microsoft 365** (MX peker på `tuacircles-com.mail.protection.outlook.com`, sjekket 19.10.2026). DNS ligger hos AWS Route 53.

- Logg inn på <https://admin.microsoft.com> med en administratorkonto for tuacircles.com.
- Billigst: **Teams og grupper → Delte postbokser → Legg til en delt postboks**, navn «Tua tech», e-post `tech@tuacircles.com`. Delte postbokser er gratis og trenger ingen lisens. Legg til deg selv som medlem, og slå på «Send kopi av mottatt e-post til medlemmene» så den dukker opp i din vanlige innboks.
- Alternativt: legg `tech@tuacircles.com` til som **alias** på din egen postboks (Brukere → Aktive brukere → din bruker → Administrer e-postaliaser). Da kan du også svare fra adressen.
- Vent 5–15 minutter, send en testmelding fra en annen konto og bekreft at den kommer fram.
- Svar på testmeldingen *fra* `tech@` om du valgte alias (ikke påkrevd, men fint for senere korrespondanse med Anthropic).

---

## 6. Legg ut personvernsiden

Fila [`docs/privacy-policy.html`](privacy-policy.html) er en selvstendig side (ingen eksterne filer, Georgia, Tua-fargene) med nøyaktig innholdet i `PRIVACY.md`. Målet er at <https://tuacircles.com/plugin-privacy> svarer med denne.

tuacircles.com kjører på **Framer** (bildene lastes fra framerusercontent.com). Status 19.10.2026: `/plugin-privacy` gir 404 (etter omdirigering til www), mens `/privacy-policy` finnes og gir 200. To veier:

- **A — i Framer:** *Pages → +* → ny side, sett *slug* til `plugin-privacy`. Legg inn et **Embed**-element (Insert → Utility → Embed, type *HTML*), strekk det til full bredde, og lim inn alt fra `<main>` til og med `</main>` **pluss** hele `<style>`-blokken fra fila. Publiser. (Framer-sider har allerede `<html>`/`<head>`, så bare kroppen trengs.)
- **B — hopp over for nå:** Portalen godtar GitHub-adressen `https://github.com/tuacircles/tua-plugin/blob/main/PRIVACY.md`. Siden kan legges ut senere; `SUBMISSION.md` lister begge.

Når A er gjort, sjekk:

```bash
curl -sI https://tuacircles.com/plugin-privacy | head -1
```

→ skal gi `HTTP/2 200`.

---

## 7. Koble GitHub til claude.ai — gjort

1. Logg inn på <https://claude.ai> med kontoen som er med i **Tua Circles**-organisasjonen (ikke en privat konto — innsendingen eies av organisasjonen).
2. Gå til <https://claude.ai/directory/manage> → **Submit new** → **Plugin bundle**.
3. I **Source**-steget: *Connect GitHub*. GitHub spør hvor Claude-appen skal installeres: velg brukerkontoen **Tuacircles** → *Only select repositories* → `tua-plugin` → *Install & Authorize*.

---

## 8. Portalen, steg for steg — gjort 19.10.2026

Alle verdiene står i [SUBMISSION.md](../SUBMISSION.md). Her er rekkefølgen og hva du skal forvente.

### Source
Repository `tuacircles/tua-plugin` · Plugin path **tomt** · Branch/tag **tomt** (= `main`), eller `v0.4.0` hvis du vil styre hver utgivelse med tagger. Trykk **Validate**.

### Validate — forventede funn
| Funn | Forventet | Hva du gjør |
|---|---|---|
| Manifest, README, LICENSE, navn, symlenker, OS-filer, launchers, hemmeligheter | ✔ grønt | Ingenting. Lokalt bestått med `claude plugin validate --strict` 19.10.2026, både med og uten `marketplace.json`. |
| **Dependencies install from a lockfile** | **Hold** (gul, «reviewer reads it») | Dette er **ventet og tilsiktet**. `package-lock.json` i rota gjør at Claude Code installerer `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps` og `zod`. Alternativet (legge ~1 MB SDK-kode i repoet) ville fått et annet hold. Gå videre; en menneskelig vurderer leser det. |
| Scripts the validator couldn't follow | Skal **ikke** dukke opp | Kommer bare når pluginen ligger i en undermappe. Dukker den opp likevel er det et hold, ikke en stopp. |
| Marketplace file | *mulig* advarsel | Hvis portalen sier «Pick one plugin first»: slett `.claude-plugin/marketplace.json` i `tua-plugin/`, commit, lag grenen på nytt (steg 2) og push (steg 4). |
| Name may be confused with an existing listing | *mulig* | Svar: Tua er det registrerte produktet til Tua Circles Holding AS, tuacircles.com, live siden 2024. |

### Listing details
Kontroller at portalen har lest fra `plugin.json`: navn **Tua**, author **Tua Circles Holding AS**, lisens **AGPL-3.0-only**. Last opp **ikonet** (PNG-fila i rota av repoet; 512 × 512, 71 KB — det er Tua-appikonet fra tuacircles.com skalert opp fra 257 px; vil du ha skarpere, be designeren om originalfila og erstatt). Fyll inn fra tabellen *Listing materials* i SUBMISSION.md: Documentation URL, Privacy policy URL (`https://tuacircles.com/plugin-privacy` hvis steg 6A er gjort, ellers GitHub-adressen), Support contact `tech@tuacircles.com`, kategorier, one-liner og detaljbeskrivelse (kopier teksten ordrett).

### Data handling
Svar nøyaktig som tabellen *Data handling step* i SUBMISSION.md: leser/lagrer persondata **ja — bare lokalt**; sender til andre tjenester **nei**; oppbevaring **så lenge brukeren beholder filene**; under 18 **nei**; helsedata/sponset **nei/nei**.

### Compliance
Contact email `tech@tuacircles.com` (steg 5 må være gjort). Huk av alle fire (eller sju) bekreftelsene — alle er sanne, se README «What the plugin runs, reads, writes and sends».

### Review & submit
*How new versions reach the directory:* **GitHub push webhook** (krever admin på repoet — det har du). *Auto-publish passing versions:* **på**. Lim «Instructions for the reviewer» fra SUBMISSION.md inn i notatfeltet. Trykk **Submit**.

Deretter: følg med på `tech@tuacircles.com`. Vurderer kan stille spørsmål; svar fra samme adresse.

---

## 8b. Slik gikk det (19.10.2026)

**Sendt inn til vurdering** fra claude.ai/directory/manage på `main @ e946abb`. Portalen svarte «Plugin submitted for review» og holder innsendingen for manuell vurdering, som ventet. Statussiden er <https://claude.ai/directory/manage/plugins/a081400a-5855-4fa5-8cd6-f540583a622f> (Submitted → Security scan → In review → Live); e-post om vurderingen går til `erik@storelia.no` (bytt til `tech@tuacircles.com` i pluginens innstillinger når postboksen finnes).

Validering: bestått, **4 varsler · 8 hold**. Holdene: (1) lockfile — ventet; (2) «Uses a credential from the user's machine», 6 funn — en heuristikk som parer ord som *passwordSet*, *~/.config/Claude* og miljøvariabler med en URL i samme fil, pluss at en testfil leser hele `process.env` og denne fila nevner `ssh`; ingenting sendes ut, og vurderer bekrefter det; (3) navnet «tua» ligner «tula» (plugin `daxgoon/tula`) — svar: Tua er Tua Circles Holding AS sitt registrerte produkt, tuacircles.com, live siden 2024. Varslene: tre «ukjente» felt i plugin.json (`documentationUrl`, `supportUrl`, `privacyPolicyUrl` — de virker likevel, Links gikk fra 3 til 5 av 6), og et «download-and-run»-varsel på `server/import.js` (henting av delt lenke; utpakkingen ble flyttet til `server/unzip.js` før innsending). Et hold om ikon-fila forsvant da dokumentene sluttet å nevne filnavnet. Hele tabellen står i `SUBMISSION.md` → *Outcome*.

Valg gjort i portalen: listet på **Claude Code og Cowork** (ikke «Claude apps», der bare skills ville blitt installert, uten server og hooks); Data handling: *Reads and stores · No · Not retained · No*; alle fire bekreftelser; **auto-publish på**; nye versjoner via **planlagt sjekk** hver 6. time (webhook kan legges til senere i pluginens innstillinger).

**Oppfølging etter innsendingen:**

1. Svar på e-post fra Anthropic (vurderer kan spørre om navnet og om «credential»-funnene).
2. **Cowork-merknad:** portalen sier serveren ikke starter i Cowork fordi `.mcp.json` henter `TUA_FILES_ROOT` fra `${user_config.arkivmappe}`, og Cowork samler ikke inn plugin-innstillinger. Serveren klarer seg uten (spør via `tua_setup` første gang). **Avgjort 19.10.2026 (0.4.1): innstillingen beholdes** (alternativ B). I Cowork lastes bare skills; tas opp igjen om Cowork blir viktig.
3. **`auto_lagring`** så ubrukt ut, men hooken leser den som `CLAUDE_PLUGIN_OPTION_AUTO_LAGRING` (slik Claude Code gir alle plugin-innstillinger til hooks). **Avgjort 19.10.2026 (0.4.1): beholdes**, med en ny test (`hook-av` i `server/test-platform.mjs`) som viser at «false» slår av fangsten.
4. `tech@tuacircles.com` (steg 5), så bytt kontaktadresse i portalen.
5. Personvernsiden på tuacircles.com (steg 6), så bytt `privacyPolicyUrl` i plugin.json.
6. Flett `claude/elastic-taussig-41b833` (som nå inneholder `claude/m18-merge`) til `main` i Tua-repoet.
7. Dokument-endringene etter innsendingen (denne fila og `SUBMISSION.md` → *Outcome*) ligger lokalt på grenen og er **ikke pushet** til GitHub, så den innsendte versjonen står i ro under vurderingen. Push dem sammen med neste versjon (steg 9).

---

## 9. Senere versjoner (til neste gang)

1. Hev `version` i `tua-plugin/.claude-plugin/plugin.json`, `tua-plugin/package.json` og `tua-plugin/server/server.js`; nytt avsnitt i `tua-plugin/CHANGELOG.md`. Commit på vanlig måte i Tua-repoet.
2. Lag grenen på nytt og push:

```bash
cd /Users/bruker/Documents/Claude/Projects/tua && git branch -D tua-plugin-export && git subtree split --prefix=tua-plugin -b tua-plugin-export && git push tua-plugin tua-plugin-export:main
```

3. Med tag-styring: `git tag v0.5.0 tua-plugin-export && git push tua-plugin v0.5.0`, og flytt portalen til den nye taggen.

**0.4.1 (forberedt 19.10.2026, ikke pushet):** versjon hevet i de tre filene, `CHANGELOG.md` har avsnittet, testene er grønne. Push skjer først når Erik sier ja, med kommandoen i punkt 2 og deretter `git tag v0.4.1 tua-plugin-export && git push tua-plugin v0.4.1`. Den innsendte versjonen (`main @ e946abb`) står i ro til da.

---

## Hva som er klart (gjort 19.10.2026, uten dine kontoer)

- **Repoet <https://github.com/tuacircles/tua-plugin>** er public, med `main` = `8eee3dc` og tag `v0.4.0`: M15 + M18 + ikon, docs og tech@. Rota har `.claude-plugin/plugin.json`, `LICENSE`, `README.md`; ingen `.DS_Store`, `node_modules` eller `server/data`. `claude plugin validate --strict` bestått både med og uten `marketplace.json`; `test-tools.mjs` og `test-platform.mjs` grønne. Eksportgrenen ble laget fra `claude/elastic-taussig-41b833` etter fletting av `claude/m18-merge`; `main` i Tua-repoet har ennå ikke disse commitene.
- **Ikonet** 512 × 512 PNG, 71 KB, i rota av `tua-plugin/`.
- **`docs/privacy-policy.html`** klar til å legges på tuacircles.com/plugin-privacy.
- **`SUBMISSION.md`** oppdatert med ikon- og personvern-URL.

## Hva som mangler (krever deg)

1. ~~GitHub-konto, repo, token og push~~ — gjort 19.10.2026.
2. Fletting av `claude/m18-merge` og `claude/elastic-taussig-41b833` til `main` i Tua-repoet (egen økt; GitHub-repoet har allerede alt innhold).
3. `tech@tuacircles.com` i Microsoft 365 (steg 5).
4. Personvernsiden på tuacircles.com (steg 6, kan utsettes).
5. ~~GitHub-kobling på claude.ai og selve innsendingen~~ — gjort 19.10.2026; se 8b for oppfølging.
