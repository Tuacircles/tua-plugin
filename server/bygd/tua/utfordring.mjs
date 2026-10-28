// Tua-plugin 0.5.8 — bygd av bygg.mjs 2026-10-28. IKKE REDIGER: kilden er server/*.js og node_modules.
// utfordring.js — skive C «Utfordre» (arbeidsstykke 34 §5 C1–C6, V23, 28.10.2026): de rene reglene. Ingen sending her — det er motor.js (utfordre()).
//
// Problemet før: «Også til <modell>» sendte SPØRSMÅLET på nytt; ingen modell ble bedt om å gå løs på SVARET, og å utfordre en fanget samtale
// krevde at hele transkriptet ble sendt. Nå: «Utfordre» står på resultatet (en sak, en konklusjon, resultatet av en samtale), og en kontrollmodell
// Erik velger hver gang får bare resultatet og kildene, med én av fire ferdige instrukser. Svaret tolkes til en liste innvendinger.
//
//   SJEKKER              de fire valgene: id, navn, kort forklaring og instruksen kontrollmodellen får (norsk; nummererte innvendinger med begrunnelse og
//                        hvor i teksten, «Ingen innvending.» når det holder). Instruksen lagres som prompt-sak (V16) i sakens prosjekt: prompt:utfordre:<sjekk>.
//   tolkInnvendinger()   modellsvaret → [{nr, tekst, hvor, begrunnelse, status: 'åpen'}]. Tåler nummer med punktum/parentes, kulepunkter, fete etiketter,
//                        «Hvor:»/«Begrunnelse:» på egne linjer eller i samme linje, og «Ingen innvending» (→ []). Aldri en feil.
//   utfordringerFor()    utfordringene av en sak, nyeste først (saken selv, eller en konklusjon låst fra en utfordring).
//   utfordringInfo()     det saken får vist: { id, av, label, modell, dato, sjekk, innvendinger, tatt_inn, avvist, åpne, låst, antall, tekst }.
//   utfordretTekst()     «Utfordret av ChatGPT 28.10 · 3 innvendinger · 2 tatt inn».
//   erUtfordring()       utfordringene, deres prompter og nye versjoner — egne saker, men ingen egne rader i avisen (de står på saken de utfordrer).
//   samtaleDokumenter()  dokumentene en samtale skrev (samme prosjekt og samtalenavn, eller bygget på samtalen) — kildene når resultatet av en samtale utfordres.
// Tester: server/test-utfordre.mjs.

const SJEKKER = [
  { id: 'svakheter', navn: 'Finn svakhetene', kort: 'Hva holder ikke, hva er svakt begrunnet?',
    instruks: 'Du er kontrollør. Les SVARET under kritisk, som en erfaren fagperson som skal finne feil før det brukes. Finn det som ikke holder: påstander som er feil, ' +
      'slutninger som ikke følger, svak eller manglende begrunnelse, og steder der svaret er mer sikkert enn grunnlaget tillater. Ikke skriv svaret på nytt, og ikke ros det.' },
  { id: 'kilder', navn: 'Sjekk mot kildene', kort: 'Stemmer hver påstand med dokumentene den viser til?',
    instruks: 'Du er kontrollør. Sjekk SVARET under mot KILDENE som følger etter det. Gå gjennom påstandene én for én: står det samme i kildene, står det noe annet, ' +
      'eller finnes det ikke der? Ta med tall, datoer, navn og sitater som ikke stemmer, og påstander som ikke har dekning. Kilder du ikke har fått, kan du ikke bruke — si det heller.' },
  { id: 'motpart', navn: 'Motpartens argument', kort: 'Hva vil den andre siden si?',
    instruks: 'Du er motpartens rådgiver. Les SVARET under og skriv de sterkeste innvendingene den andre siden vil komme med: argumentene, faktaene og tolkningene ' +
      'de vil bruke, og hvor svaret er sårbart for dem. Vær konkret og saklig; ikke finn på fakta som ikke står i svaret eller kildene.' },
  { id: 'mangler', navn: 'Hva mangler', kort: 'Hva burde vært med, men er ikke?',
    instruks: 'Du er kontrollør. Les SVARET under og finn det som mangler: spørsmål det ikke svarer på, forhold, risikoer, alternativer eller kilder som burde vært med, ' +
      'og forutsetninger som ikke er sagt høyt. Bare det som faktisk betyr noe for bruken av svaret.' },
];
const sjekkAv = (id) => SJEKKER.find((s) => s.id === id) || null;
const KORT = { openai: 'ChatGPT', claude: 'Claude', mistral: 'Mistral', test: 'Test', test2: 'Test 2', testlokal: 'Test lokal' };
function kortKontroll(u) {
  if (!u) return ''
  if (u.mottaker === 'ollama') return String(u.modell || 'lokal modell').split(':')[0]
  return KORT[u.mottaker] || String(u.label || u.mottaker || 'modell').split(' (')[0]
}
const ddmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}` };
function utfordretTekst(i) {
  if (!i) return ''
  const n = i.innvendinger || 0;
  return `Utfordret av ${i.av}${i.dato ? ` ${ddmm(i.dato)}` : ''} · ${n ? `${n} ${n === 1 ? 'innvending' : 'innvendinger'} · ${i.tatt_inn || 0} tatt inn` : 'ingen innvendinger'}`
}
// utfordringene av saken (nyeste først). En konklusjon låst fra en utfordring regnes som utfordret av den samme.
function utfordringerFor(atoms, sak) {
  if (!sak) return []
  const egne = (atoms || []).filter((a) => a.utfordring && a.utfordrer?.id === sak.id);
  const viaKonklusjon = sak.kind === 'konklusjon' ? (sak.derivedFrom || []).map((d) => (atoms || []).find((a) => a.id === d.id && a.utfordring)).filter(Boolean) : [];
  return [...new Map([...egne, ...viaKonklusjon].map((a) => [a.id, a])).values()].sort((x, y) => String(y.utfordring.dato || '').localeCompare(String(x.utfordring.dato || '')) || (y.capturedAt || 0) - (x.capturedAt || 0))
}
function infoAv(u, antall = 1) {
  if (!u?.utfordring) return null
  const iv = u.utfordring.innvendinger || [];
  const i = { id: u.id, av: kortKontroll(u.utfordring), label: u.utfordring.label || u.source || '', mottaker: u.utfordring.mottaker || '', modell: u.utfordring.modell || '', dato: u.utfordring.dato || '',
    sjekk: u.utfordring.sjekk || '', sjekkNavn: sjekkAv(u.utfordring.sjekk)?.navn || '', innvendinger: iv.length, tatt_inn: iv.filter((x) => x.status === 'godtatt').length, avvist: iv.filter((x) => x.status === 'avvist').length,
    åpne: iv.filter((x) => !x.status || x.status === 'åpen').length, låst: !!u.utfordring.låst, ny_versjon: u.utfordring.nyVersjon || null, konklusjon: u.utfordring.konklusjon || null, antall };
  return { ...i, tekst: utfordretTekst(i) }
}
function utfordringInfo(atoms, sak) { const l = utfordringerFor(atoms, sak); return l.length ? infoAv(l[0], l.length) : null }

export { utfordringInfo };
