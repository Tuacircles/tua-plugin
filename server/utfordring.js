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

export const SJEKKER = [
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
]
export const FORMAT = 'Svar på norsk med en nummerert liste over innvendinger, viktigste først, høyst ti. Hver innvending på denne formen:\n\n' +
  '1. Innvendingen i én setning.\n   Hvor: kort sitat eller avsnittet i svaret det gjelder.\n   Begrunnelse: hvorfor det er et problem, i én til tre setninger.\n\n' +
  'Ingen innledning og ingen oppsummering. Holder svaret på dette punktet, skriv bare «Ingen innvending.» Bruk plassholdere som [Person A] uendret.'
export const sjekkAv = (id) => SJEKKER.find((s) => s.id === id) || null
export const instruksFor = (id) => { const s = sjekkAv(id); return s ? `${s.instruks}\n\n${FORMAT}` : '' }

// ── tolking ──────────────────────────────────────────────────────────────────
const INGEN = /^\s*[*_"«]*\s*ingen\s+(vesentlige\s+)?innvending(er)?\b/i
const ETIKETT = /^\s*[-*•]?\s*(?:\*\*|__)?\s*(hvor|sted|plassering|begrunnelse|hvorfor|grunn)\s*(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.*)$/i
const PUNKT = /^\s*(?:(\d{1,2})\s*[.)]|[-*•])\s+(.+)$/
const rens = (t) => String(t || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim()
export function tolkInnvendinger(tekst) {
  const t = String(tekst || '').replace(/\r/g, '')
  if (!t.trim() || INGEN.test(t.trim().split('\n').find((l) => l.trim()) || '')) return []
  const ut = []
  let nå = null
  const slutt = () => { if (nå && nå.tekst) ut.push(nå); nå = null }
  for (const linje of t.split('\n')) {
    if (!linje.trim()) continue
    const e = linje.match(ETIKETT)
    if (e && nå) { const felt = /hvor|sted|plassering/i.test(e[1]) ? 'hvor' : 'begrunnelse'; nå[felt] = rens([nå[felt], e[2]].filter(Boolean).join(' ')); nå.sist = felt; continue }
    const p = linje.match(PUNKT)
    const innrykk = /^\s{2,}/.test(linje) && !/^\s*\d{1,2}\s*[.)]/.test(linje)
    if (p && !(innrykk && nå && !p[1])) {
      slutt()
      // «Innvending. Hvor: … Begrunnelse: …» i samme linje
      let hele = p[2], hvor = '', begr = ''
      const b = hele.match(/\s(?:\*\*)?begrunnelse(?:\*\*)?\s*[:：]\s*(.*)$/i); if (b) { begr = b[1]; hele = hele.slice(0, b.index) }
      const h = hele.match(/\s(?:\*\*)?hvor(?:\*\*)?\s*[:：]\s*(.*)$/i); if (h) { hvor = h[1]; hele = hele.slice(0, h.index) }
      nå = { tekst: rens(hele).replace(/^(innvending\s*\d*\s*[:：]\s*)/i, ''), hvor: rens(hvor), begrunnelse: rens(begr), sist: 'tekst' }
      if (INGEN.test(nå.tekst)) nå = null
      continue
    }
    if (nå) { const f = nå.sist === 'tekst' ? (nå.begrunnelse ? 'begrunnelse' : 'tekst') : nå.sist; nå[f] = rens(`${nå[f]} ${linje}`) }   // fortsettelse av forrige felt
  }
  slutt()
  if (!ut.length) { const flat = rens(t); return flat && !INGEN.test(flat) ? [{ nr: 1, tekst: flat.slice(0, 600), hvor: '', begrunnelse: '', status: 'åpen', utolket: true }] : [] }
  return ut.slice(0, 20).map((x, i) => ({ nr: i + 1, tekst: x.tekst, hvor: x.hvor || '', begrunnelse: x.begrunnelse || '', status: 'åpen' }))
}
export const STATUSER = ['åpen', 'godtatt', 'avvist']

// ── på saken ─────────────────────────────────────────────────────────────────
export const erUtfordring = (a) => !!a && (a.utfordring != null || (a.tags || []).some((t) => ['utfordring', 'ny-versjon'].includes(String(t).toLowerCase())))
const KORT = { openai: 'ChatGPT', claude: 'Claude', mistral: 'Mistral', test: 'Test', test2: 'Test 2', testlokal: 'Test lokal' }
export function kortKontroll(u) {
  if (!u) return ''
  if (u.mottaker === 'ollama') return String(u.modell || 'lokal modell').split(':')[0]
  return KORT[u.mottaker] || String(u.label || u.mottaker || 'modell').split(' (')[0]
}
const ddmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}` }
export function utfordretTekst(i) {
  if (!i) return ''
  const n = i.innvendinger || 0
  return `Utfordret av ${i.av}${i.dato ? ` ${ddmm(i.dato)}` : ''} · ${n ? `${n} ${n === 1 ? 'innvending' : 'innvendinger'} · ${i.tatt_inn || 0} tatt inn` : 'ingen innvendinger'}`
}
// utfordringene av saken (nyeste først). En konklusjon låst fra en utfordring regnes som utfordret av den samme.
export function utfordringerFor(atoms, sak) {
  if (!sak) return []
  const egne = (atoms || []).filter((a) => a.utfordring && a.utfordrer?.id === sak.id)
  const viaKonklusjon = sak.kind === 'konklusjon' ? (sak.derivedFrom || []).map((d) => (atoms || []).find((a) => a.id === d.id && a.utfordring)).filter(Boolean) : []
  return [...new Map([...egne, ...viaKonklusjon].map((a) => [a.id, a])).values()].sort((x, y) => String(y.utfordring.dato || '').localeCompare(String(x.utfordring.dato || '')) || (y.capturedAt || 0) - (x.capturedAt || 0))
}
export function infoAv(u, antall = 1) {
  if (!u?.utfordring) return null
  const iv = u.utfordring.innvendinger || []
  const i = { id: u.id, av: kortKontroll(u.utfordring), label: u.utfordring.label || u.source || '', mottaker: u.utfordring.mottaker || '', modell: u.utfordring.modell || '', dato: u.utfordring.dato || '',
    sjekk: u.utfordring.sjekk || '', sjekkNavn: sjekkAv(u.utfordring.sjekk)?.navn || '', innvendinger: iv.length, tatt_inn: iv.filter((x) => x.status === 'godtatt').length, avvist: iv.filter((x) => x.status === 'avvist').length,
    åpne: iv.filter((x) => !x.status || x.status === 'åpen').length, låst: !!u.utfordring.låst, ny_versjon: u.utfordring.nyVersjon || null, konklusjon: u.utfordring.konklusjon || null, antall }
  return { ...i, tekst: utfordretTekst(i) }
}
export function utfordringInfo(atoms, sak) { const l = utfordringerFor(atoms, sak); return l.length ? infoAv(l[0], l.length) : null }
// Hele arkivet på én gang (GET /api/atoms): Map sak-id → info, uten å lete gjennom alt per sak
export function utfordringKart(atoms) {
  const per = new Map()
  for (const a of atoms || []) if (a.utfordring && a.utfordrer?.id) { const l = per.get(a.utfordrer.id) || []; l.push(a); per.set(a.utfordrer.id, l) }
  const ut = new Map()
  const nyest = (l) => [...l].sort((x, y) => String(y.utfordring.dato || '').localeCompare(String(x.utfordring.dato || '')))
  for (const [id, l] of per) ut.set(id, infoAv(nyest(l)[0], l.length))
  for (const a of atoms || []) if (a.kind === 'konklusjon' && !ut.has(a.id)) { const u = (a.derivedFrom || []).map((d) => (atoms || []).find((x) => x.id === d.id && x.utfordring)).find(Boolean); if (u) ut.set(a.id, infoAv(u)) }
  return ut
}

// ── kildene til en samtale ───────────────────────────────────────────────────
const DEL = new Set(['prompt', 'svar', 'samtale', 'konklusjon'])
const erDokument = (a) => !!a && !DEL.has(a.kind) && !(a.tags || []).some((t) => ['svar', 'prompt', 'forskjeller'].includes(String(t).toLowerCase())) && !/^(svar|prompt|okt|forskjeller|konklusjon):/.test(String(a.key || '')) && !erUtfordring(a)
export function samtaleDokumenter(atoms, samtale) {
  if (!samtale) return []
  const navn = samtale.convo || samtale.name || ''
  const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase()
  return (atoms || []).filter((a) => a.id !== samtale.id && erDokument(a) && ((a.derivedFrom || []).some((d) => d.id === samtale.id) || (navn && same(a.project, samtale.project) && (a.convo || '') === navn)))
    .sort((x, y) => (y.capturedAt || 0) - (x.capturedAt || 0))
}
export { erDokument }

// ── C6: resultatet av en samtale ─────────────────────────────────────────────
// Et arbeidssteg er et modellsvar som bare forteller hva modellen gjør («Nå setter jeg opp en arbeidsplan …»): kort (< 400 tegn), eller som begynner
// som et arbeidsnotat og er under 1 500 tegn. Resultatet er siste modellsvar som ikke er et arbeidssteg — ellers siste modellsvar. Samme regel i
// appen (regler.samtaleResultat), så det Erik ser øverst er det som sendes.
export const STEG_START = /^\s*(nå\s|la meg\b|jeg (skal|starter|begynner|går|leser|ser på|sjekker|lager|setter|henter|åpner|fortsetter)\b|først\b|deretter\b|så\s(skal|lager|ser|sjekker)\b|ok[,.!\s]|greit\b|flott\b|bra[,.!]|let me\b|i'll\b|i will\b|now\s|first\b|next\b|okay\b|great\b|perfect\b)/i
export const erArbeidssteg = (v) => !!v && v.rolle === 'modell' && (() => { const t = String(v.L || v.S || '').trim(); return t.length < 400 || (STEG_START.test(t) && t.length < 1500) })()
export function resultatVending(vend = []) {
  const modell = (vend || []).filter((v) => v.rolle === 'modell')
  return [...modell].reverse().find((v) => !erArbeidssteg(v)) || modell.at(-1) || null
}
