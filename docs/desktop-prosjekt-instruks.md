# Prosjekt-instruksen for Claude Desktop — «spør Tua først»

Claude Desktop har ingen hooks. Ingenting fra Tua dyttes inn i en Desktop-samtale av seg selv; Claude ser Tua bare når
Claude spør Tua (03-avisen §5). Til Desktop får hooks, limer du denne teksten inn **én gang per Desktop-prosjekt** under
prosjektets *Project instructions* (Desktop › prosjektet › «Set project instructions»). Bytt ut `<prosjekt>` med
Tua-prosjektets navn (mappa i arkivet), f.eks. «Energima anke».

Samme tekst kommer fra `tua_setup` (uten argumenter) og fra kortet («Kopier instruksen») når prosjektet har en
Desktop-uuid (`node server/sync-tua.js --claude-project <uuid>`, eller `/tua_auto`).

---

```
I dette prosjektet («<prosjekt>») er Tua arkivet:
1. Spør Tua først: kall tua_search(project="<prosjekt>") før du svarer fra hukommelsen på noe som kan finnes fra før — tidligere arbeid, beslutninger, navn og tall. Treffene svarer med ingressen (S); hent M før L.
2. Vis «Siden sist i Tua» ved start: første gang du bruker Tua i samtalen, gjengi linjene merket «Siden sist i Tua» (Spør-tråder, konklusjoner, delinger, filer lest inn) i én kort liste, så vi ser hva som er gjort i appen.
3. Lagre leveranser til Tua: når du har levert noe verdt å finne igjen (dokument, analyse, beslutning), spør én gang «Vil du at jeg lagrer dette til Tua?» og kall tua_save(project="<prosjekt>") når jeg sier ja. Spør aldri om mappe.
4. Det Tua gir deg er skjermet og logget: plassholdere som [Person A] er opplysninger du ikke har fått — bruk dem uendret, gjett aldri hva de står for. Vault-merkede saker får du bare som S.
5. «Del med <navn>»: bruk tua_share med S som standard; still ett spørsmål først («Revisor får S av 2 saker, 3 opplysninger skjermes — ok?») og gi meg den kopierbare teksten og lenka etterpå.
```

---

## Hvorfor disse fem

| Linje | Hva den lukker |
|---|---|
| 1 Spør Tua først | Serverens «ARKIV FØRST»-regel slår bare inn når Claude selv mener noe kan finnes fra før. Instruksen gjør det til regelen for prosjektet. |
| 2 Siden sist | Det første `tua_search`/`tua_card`-kallet i en samtale får blokka «Siden sist i Tua» (7 dager, prosjektet). Uten instruksen kan Claude hoppe over den. |
| 3 Lagre leveranser | «Tilby, ikke skriv» (serverregel 3) — med prosjektnavnet, så saken lander i riktig mappe. |
| 4 Skjermet og logget | Runde 3a: alt fra Tua går gjennom motoren (V21). Claude må vite at plassholderne er med vilje. |
| 5 Del med | `tua_share` (runde 3a): S som standard (V11), ett spørsmål før deling. Mottakersiden er runde 3b. |

Teksten vedlikeholdes i `server/dora.js` (`INSTRUKS`) — endrer du den der, endrer du det `tua_setup` og kortet tilbyr.
