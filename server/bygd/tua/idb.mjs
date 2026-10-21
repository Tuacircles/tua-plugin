// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
import fs from 'node:fs';
import path from 'node:path';

// idb.js — leser Chromiums IndexedDB (LevelDB på disk) i ren Node, uten native avhengigheter.
//
// Claude Desktop er en Chromium-app. Fra ca. 15.09.2026 (Desktop 2.42304) ligger samtaleinnholdet ikke lenger i
// HTTP-cachen (Cache/Cache_Data), men i appens IndexedDB:
//
//   ~/Library/Application Support/Claude/IndexedDB/https_claude.ai_0.indexeddb.leveldb/   (LevelDB: *.ldb + *.log)
//   ~/Library/Application Support/Claude/IndexedDB/https_claude.ai_0.indexeddb.blob/      (store verdier som egne filer)
//
// Fire lag, alle dokumentert i Chromium/LevelDB-kildene og verifisert mot Eriks maskin 20.10.2026 med
// ccl_chromium_reader (CCL Forensics, MIT) som fasit:
//   1. LevelDB:   tabellfiler (.ldb: blokker med prefiks-komprimerte nøkler, Snappy per blokk, indeks + footer med magic)
//                 og loggfiler (.log: 32 kB-blokker med 7 B record-header, batcher med sekvensnummer). Nyeste sekvens-
//                 nummer per nøkkel vinner; en slette-post fjerner nøkkelen.
//   2. Snappy:    ren JS-dekoder (literal / copy-1 / copy-2 / copy-4).
//   3. IndexedDB: nøkkelprefiks [lengdebyte][db-id][store-id][indeks-id]; globale metadata (db-navn) under 00 00 00 00 c9,
//                 store-navn under <db,0,0> 50; poster under indeks 1; blob-info under indeks 3. Nøkkeltyper: null,
//                 streng (utf-16be), dato, tall, array, binær.
//   4. Verdier:   varint versjon · Blink-konvolutt (0xff, versjon; 0x11 + 0x01 = ekstern blob, 0x11 + 0x02 = Snappy;
//                 ≥ 21 har 13 B trailer) · V8-serialisering (0xff, versjon, så tagger: o { A $ a @ " S c I U N D T F 0 _ ^ …).
//
// Bare lesing. Ingenting skrives til appens mappe. Leses av desktop.js (samtalelageret «claude-conversation-store»).


// ── varint (LEB128, little-endian) ──────────────────────────────────────────
function varint(buf, off) {
  let result = 0, mul = 1, i = 0;
  for (;;) {
    if (off + i >= buf.length) throw new Error('varint utenfor bufferet')
    const b = buf[off + i];
    result += (b & 0x7f) * mul;
    i++;
    if ((b & 0x80) === 0) break
    mul *= 128;
    if (i > 10) throw new Error('varint for lang')
  }
  return [result, i]
}

// ── Snappy (rå blokkformat, ikke framed) ────────────────────────────────────
function snappyDecompress(buf) {
  const [ulen, n0] = varint(buf, 0);
  const out = Buffer.alloc(ulen);
  let off = n0, o = 0;
  while (off < buf.length) {
    const t = buf[off++];
    const tag = t & 3;
    if (tag === 0) {
      const n = t >> 2;
      let len;
      if (n < 60) len = n + 1;
      else if (n === 60) { len = buf[off] + 1; off += 1; }
      else if (n === 61) { len = buf.readUInt16LE(off) + 1; off += 2; }
      else if (n === 62) { len = (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16)) + 1; off += 3; }
      else { len = buf.readUInt32LE(off) + 1; off += 4; }
      if (off + len > buf.length || o + len > ulen) throw new Error('Snappy: literal utenfor bufferet')
      buf.copy(out, o, off, off + len); off += len; o += len;
    } else {
      let len, back;
      if (tag === 1) { len = ((t >> 2) & 7) + 4; back = ((t & 0xe0) << 3) | buf[off]; off += 1; }
      else if (tag === 2) { len = (t >> 2) + 1; back = buf.readUInt16LE(off); off += 2; }
      else { len = (t >> 2) + 1; back = buf.readUInt32LE(off); off += 4; }
      if (back === 0 || back > o || o + len > ulen) throw new Error('Snappy: ugyldig kopi')
      for (let i = 0; i < len; i++) { out[o] = out[o - back]; o++; }      // byte for byte: overlapp er lov
    }
  }
  if (o !== ulen) throw new Error(`Snappy: fikk ${o} B, ventet ${ulen}`)
  return out
}

// ── LevelDB: tabellfil (.ldb) ────────────────────────────────────────────────
const LDB_MAGIC = Buffer.from('57fb808b247547db', 'hex');          // 0xdb4775248b80fb57 little-endian
function blockEntries(raw) {
  const count = raw.readUInt32LE(raw.length - 4);
  const restartOff = raw.length - (count + 1) * 4;
  const out = [];
  let pos = count ? raw.readUInt32LE(restartOff) : 0;
  let key = Buffer.alloc(0);
  while (pos < restartOff) {
    const [shared, a] = varint(raw, pos); pos += a;
    const [nonShared, b] = varint(raw, pos); pos += b;
    const [vlen, c] = varint(raw, pos); pos += c;
    if (shared > key.length) throw new Error('LevelDB: delt nøkkel lengre enn forrige')
    key = Buffer.concat([key.subarray(0, shared), raw.subarray(pos, pos + nonShared)]); pos += nonShared;
    out.push({ key, value: raw.subarray(pos, pos + vlen) }); pos += vlen;
  }
  return out
}
function* ldbRecords(buf) {
  if (buf.length < 48 || !buf.subarray(buf.length - 8).equals(LDB_MAGIC)) throw new Error('LevelDB: feil magic i tabellfil')
  const footer = buf.length - 48;
  let p = footer;
  const [, m1] = varint(buf, p); p += m1; const [, m2] = varint(buf, p); p += m2;       // metaindex-handle (ubrukt)
  const [idxOff, i1] = varint(buf, p); p += i1; const [idxLen] = varint(buf, p);
  const readBlock = (off, len) => {
    let raw = buf.subarray(off, off + len);
    const compressed = buf[off + len] !== 0;
    if (compressed) raw = snappyDecompress(raw);
    return raw
  };
  for (const e of blockEntries(readBlock(idxOff, idxLen))) {
    const [off, a] = varint(e.value, 0); const [len] = varint(e.value, a);
    for (const r of blockEntries(readBlock(off, len))) {
      if (r.key.length < 8) continue
      const tail = r.key.readBigUInt64LE(r.key.length - 8);
      yield { ukey: r.key.subarray(0, r.key.length - 8), seq: Number(tail >> 8n), live: Number(tail & 0xffn) === 1, value: r.value };
    }
  }
}

// ── LevelDB: loggfil (.log) ─────────────────────────────────────────────────
function* logRecords(buf) {
  const BLOCK = 32768;
  let acc = null;
  const batches = [];
  for (let bs = 0; bs < buf.length; bs += BLOCK) {
    const end = Math.min(bs + BLOCK, buf.length);
    let pos = bs;
    while (pos + 7 <= end) {
      const len = buf.readUInt16LE(pos + 4), type = buf[pos + 6];
      pos += 7;
      if (type === 0 && len === 0) break                                   // utfylling til blokkslutt
      if (pos + len > end) { pos = end; break }                            // avkuttet (appen skriver): stopp her
      const data = buf.subarray(pos, pos + len); pos += len;
      if (type === 1) batches.push(data);
      else if (type === 2) acc = [data];
      else if (type === 3) { if (acc) acc.push(data); }
      else if (type === 4) { if (acc) { acc.push(data); batches.push(Buffer.concat(acc)); acc = null; } }
    }
  }
  for (const b of batches) {
    if (b.length < 12) continue
    const seq = Number(b.readBigUInt64LE(0)), count = b.readUInt32LE(8);
    let pos = 12;
    try {
      for (let i = 0; i < count; i++) {
        const t = b[pos++];
        const [klen, a] = varint(b, pos); pos += a;
        const key = b.subarray(pos, pos + klen); pos += klen;
        let value = Buffer.alloc(0);
        if (t === 1) { const [vlen, c] = varint(b, pos); pos += c; value = b.subarray(pos, pos + vlen); pos += vlen; }
        yield { ukey: key, seq: seq + i, live: t === 1, value };
      }
    } catch { /* ufullstendig batch: resten hoppes over */ }
  }
}

// ── hele databasen: nyeste sekvensnummer per nøkkel vinner ──────────────────
function loadLevelDb(dir) {
  const best = new Map();                     // nøkkel (latin1) → { ukey, seq, live, value }
  const files = fs.readdirSync(dir).filter((f) => /^[0-9a-f]{6}\.(ldb|log|sst)$/i.test(f)).sort();
  let errors = 0;
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(path.join(dir, f)); } catch { errors++; continue }
    try {
      const it = f.toLowerCase().endsWith('.log') ? logRecords(buf) : ldbRecords(buf);
      for (const r of it) {
        const k = r.ukey.toString('latin1');
        const cur = best.get(k);
        if (!cur || r.seq >= cur.seq) best.set(k, r);
      }
    } catch { errors++; }
  }
  return { best, errors, files: files.length }
}

// ── IndexedDB-nøkler ────────────────────────────────────────────────────────
const leBytes = (v) => { const out = []; do { out.push(v & 0xff); v = Math.floor(v / 256); } while (v > 0); return out };
function makePrefix(dbId, storeId, indexId, tail = []) {
  const a = leBytes(dbId), b = leBytes(storeId), c = leBytes(indexId);
  return Buffer.from([((a.length - 1) << 5) | ((b.length - 1) << 2) | (c.length - 1), ...a, ...b, ...c, ...tail])
}
const utf16be = (buf) => { const b = Buffer.from(buf); b.swap16(); return b.toString('utf16le') };
function parseKey(buf, off = 0) {
  const t = buf[off];
  if (t === 0) return { type: 'null', value: null, len: 1 }
  if (t === 1) { const [n, a] = varint(buf, off + 1); return { type: 'string', value: utf16be(buf.subarray(off + 1 + a, off + 1 + a + n * 2)), len: 1 + a + n * 2 } }
  if (t === 2) return { type: 'date', value: new Date(buf.readDoubleLE(off + 1)), len: 9 }
  if (t === 3) return { type: 'number', value: buf.readDoubleLE(off + 1), len: 9 }
  if (t === 4) {
    const [n, a] = varint(buf, off + 1); let p = off + 1 + a; const items = [];
    for (let i = 0; i < n; i++) { const k = parseKey(buf, p); items.push(k.value); p += k.len; }
    return { type: 'array', value: items, len: p - off }
  }
  if (t === 6) { const [n, a] = varint(buf, off + 1); return { type: 'binary', value: buf.subarray(off + 1 + a, off + 1 + a + n), len: 1 + a + n } }
  throw new Error(`IndexedDB: ukjent nøkkeltype ${t}`)
}
const truncInt = (buf) => { let v = 0; for (let i = buf.length - 1; i >= 0; i--) v = v * 256 + buf[i]; return v };

// ── V8-verdier ──────────────────────────────────────────────────────────────
const UNDEFINED = Symbol('undefined');
class V8Reader {
  constructor(buf, off, host) { this.b = buf; this.p = off; this.objects = []; this.host = host; this.version = this.header(); }
  byte() { if (this.p >= this.b.length) throw new Error('V8: slutt på data'); return this.b[this.p++] }
  tag() { let t; do t = this.byte(); while (t === 0); return t }                      // 0x00 = utfylling
  peek() { const p = this.p; const t = this.tag(); this.p = p; return t }
  vint() { const [v, n] = varint(this.b, this.p); this.p += n; return v }
  zigzag() { const u = this.vint(); return (u % 2) ? -Math.floor(u / 2) : u / 2 }
  double() { const v = this.b.readDoubleLE(this.p); this.p += 8; return v }
  raw(n) { if (this.p + n > this.b.length) throw new Error('V8: streng utenfor bufferet'); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s }
  header() { if (this.byte() !== 0xff) throw new Error('V8: mangler versjonstagg'); return this.vint() }
  str1() { return this.raw(this.vint()).toString('latin1') }
  str2() { return this.raw(this.vint()).toString('utf16le') }
  strU() { return this.raw(this.vint()).toString('utf8') }
  props(endTag, into) {
    let n = 0;
    while (this.peek() !== endTag) { const k = this.read(); const v = this.read(); into(k, v); n++; }
    this.tag();
    return n
  }
  read() {
    let v = this.readInner();
    if (this.p < this.b.length && this.peek() === 0x56) {                              // 'V' ArrayBufferView
      this.tag(); this.vint(); const bo = this.vint(); const bl = this.vint(); if (this.version >= 14) this.vint();
      v = Buffer.isBuffer(v) ? v.subarray(bo, bo + bl) : v;
    }
    return v
  }
  readInner() {
    const t = this.tag();
    switch (t) {
      case 0x5f: case 0x2d: return UNDEFINED                                            // '_' undefined, '-' hull
      case 0x30: return null                                                            // '0'
      case 0x54: return true                                                            // 'T'
      case 0x46: return false                                                           // 'F'
      case 0x49: return this.zigzag()                                                   // 'I' int32
      case 0x55: return this.vint()                                                     // 'U' uint32
      case 0x4e: return this.double()                                                   // 'N' double
      case 0x44: { const d = new Date(this.double()); this.objects.push(d); return d }  // 'D'
      case 0x5a: case 0x7a: { const f = this.vint(); const n = f >> 4; const raw = this.raw(n * 8); let v = 0n; for (let i = raw.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(raw[i]); v = (f & 1) ? -v : v; if (t === 0x7a) this.objects.push(v); return v }
      case 0x53: return this.strU()                                                     // 'S' utf8
      case 0x22: return this.str1()                                                     // '"' latin1
      case 0x63: return this.str2()                                                     // 'c' utf16le
      case 0x79: { this.objects.push(true); return true }                               // 'y'
      case 0x78: { this.objects.push(false); return false }                             // 'x'
      case 0x6e: { const v = this.double(); this.objects.push(v); return v }            // 'n'
      case 0x73: { const v = this.read(); this.objects.push(v); return v }              // 's'
      case 0x5e: return this.objects[this.vint()]                                       // '^' referanse
      case 0x6f: {                                                                      // 'o' objekt
        const o = {}; this.objects.push(o);
        const n = this.props(0x7b, (k, v) => { o[k] = v; });
        if (this.vint() !== n) throw new Error('V8: feil antall egenskaper')
        return o
      }
      case 0x41: {                                                                      // 'A' tett array
        const len = this.vint(); const a = new Array(len); this.objects.push(a);
        for (let i = 0; i < len; i++) { const v = this.read(); a[i] = v === UNDEFINED ? undefined : v; }
        const n = this.props(0x24, (k, v) => { a[k] = v; }); if (this.vint() !== n) throw new Error('V8: feil antall egenskaper (array)'); this.vint();
        return a
      }
      case 0x61: {                                                                      // 'a' glissen array
        const len = this.vint(); const a = new Array(len); this.objects.push(a);
        const n = this.props(0x40, (k, v) => { a[k] = v; }); if (this.vint() !== n) throw new Error('V8: feil antall egenskaper (array)'); this.vint();
        return a
      }
      case 0x3b: { const m = new Map(); this.objects.push(m); while (this.peek() !== 0x3a) { const k = this.read(); m.set(k, this.read()); } this.tag(); this.vint(); return m }   // ';' Map ':'
      case 0x27: { const s = new Set(); this.objects.push(s); while (this.peek() !== 0x2c) s.add(this.read()); this.tag(); this.vint(); return s }                               // "'" Set ','
      case 0x42: { const raw = Buffer.from(this.raw(this.vint())); this.objects.push(raw); return raw }                                                                           // 'B' ArrayBuffer
      case 0x52: { const src = this.read(); const flags = this.vint(); const r = { regex: src, flags }; this.objects.push(r); return r }                                          // 'R'
      case 0x70: return { sharedObject: this.vint() }                                                                                                                             // 'p'
      case 0x5c: { const v = this.host(this); this.objects.push(v); return v }                                                                                                    // '\' vertsobjekt (Blink)
      default: throw new Error(`V8: ukjent tagg 0x${t.toString(16)} ved ${this.p - 1}`)
    }
  }
}
// Blink-vertsobjekter vi trenger: blob-/fil-indekser. Alt annet (CryptoKey, DOM-typer) avvises → posten hoppes over.
function blinkHost(r) {
  const t = r.byte();
  if (t === 0x69) return { blobIndex: r.vint() }                                        // 'i'
  if (t === 0x65) return { fileIndex: r.vint() }                                        // 'e'
  if (t === 0x4c) { const n = r.vint(); const out = []; for (let i = 0; i < n; i++) out.push({ fileIndex: r.vint() }); return out }   // 'L'
  throw new Error(`Blink: vertsobjekt 0x${t.toString(16)} støttes ikke`)
}

// ── IndexedDB-databasen ─────────────────────────────────────────────────────
class ChromeIndexedDb {
  constructor(leveldbDir, blobDir = null) {
    this.dir = leveldbDir; this.blobDir = blobDir;
    const { best, errors, files } = loadLevelDb(leveldbDir);
    this.all = [...best.values()].filter((r) => r.live);
    this.errors = errors; this.files = files;
    this.databases = [];
    for (const r of this.all) {
      const k = r.ukey;
      if (k.length > 5 && k[0] === 0 && k[1] === 0 && k[2] === 0 && k[3] === 0 && k[4] === 0xc9) {
        let p = 5; const [ol, a] = varint(k, p); p += a; const origin = utf16be(k.subarray(p, p + ol * 2)); p += ol * 2;
        const [nl, b] = varint(k, p); p += b; const name = utf16be(k.subarray(p, p + nl * 2));
        this.databases.push({ id: truncInt(r.value), origin, name });
      }
    }
    this.blobCache = new Map();
  }
  stores(dbId) {
    const prefix = makePrefix(dbId, 0, 0, [50]); const out = new Map();
    for (const r of this.all) {
      if (r.ukey.length <= prefix.length || !r.ukey.subarray(0, prefix.length).equals(prefix)) continue
      const [storeId, a] = varint(r.ukey, prefix.length);
      if (r.ukey[prefix.length + a] === 0) out.set(utf16be(r.value), storeId);
    }
    return out
  }
  database(name) { return this.databases.find((d) => d.name === name) || null }
  blobPath(dbId, storeId, rawKey, index) {
    const ck = `${dbId}/${storeId}/${rawKey.toString('latin1')}`;
    if (!this.blobCache.has(ck)) {
      const prefix = makePrefix(dbId, storeId, 3);
      const want = Buffer.concat([prefix, rawKey]);
      const list = [];
      const rec = this.all.find((r) => r.ukey.equals(want));
      if (rec) {
        let p = 0; const v = rec.value;
        while (p < v.length) {
          const type = v[p++]; const [num, a] = varint(v, p); p += a;
          const [ml, b] = varint(v, p); p += b + ml * 2;
          const [, c] = varint(v, p); p += c;                                               // størrelse
          if (type === 1) { const [fl, d] = varint(v, p); p += d + fl * 2; const [, e] = varint(v, p); p += e; }
          list.push(num);
        }
      }
      this.blobCache.set(ck, list);
    }
    const num = this.blobCache.get(ck)[index];
    if (num == null || !this.blobDir) return null
    return path.join(this.blobDir, dbId.toString(16), (num >> 8).toString(16).padStart(2, '0'), num.toString(16))
  }
  decode(buf, dbId, storeId, rawKey) {
    if (buf[0] !== 0xff) throw new Error('Blink: mangler versjonstagg')
    const [bver, n] = varint(buf, 1); let off = 1 + n;
    if (bver === 0x11) {
      if (buf[off] === 1) {
        off++; const [, a] = varint(buf, off); off += a; const [idx, b] = varint(buf, off); off += b;
        const p = this.blobPath(dbId, storeId, rawKey, idx);
        if (!p) throw new Error('Blink: blob-info mangler')
        return this.decode(fs.readFileSync(p), dbId, storeId, rawKey)                   // ENOENT → posten hoppes over
      }
      if (buf[off] === 2) return this.decode(snappyDecompress(buf.subarray(off + 1)), dbId, storeId, rawKey)
      throw new Error('Blink: ukjent 0x11-undertype')
    }
    if (bver >= 21) off += 13;                                                            // trailer: 0xfe + u64 + u32
    return new V8Reader(buf, off, blinkHost).read()
  }
  // Alle levende poster i et objektlager: { key, value } — poster som ikke lar seg dekode, telles i `skipped`.
  *records(dbName, storeName, stats = {}) {
    const db = this.database(dbName); if (!db) return
    const storeId = this.stores(db.id).get(storeName); if (storeId == null) return
    const prefix = makePrefix(db.id, storeId, 1);
    for (const r of this.all) {
      if (r.ukey.length <= prefix.length || !r.ukey.subarray(0, prefix.length).equals(prefix)) continue
      let key;
      try { key = parseKey(r.ukey, prefix.length); } catch { stats.skipped = (stats.skipped || 0) + 1; continue }
      const rawKey = r.ukey.subarray(prefix.length, prefix.length + key.len);
      if (!r.value.length) continue
      try {
        const [, a] = varint(r.value, 0);
        yield { key: key.value, value: this.decode(r.value.subarray(a), db.id, storeId, rawKey) };
      } catch { stats.skipped = (stats.skipped || 0) + 1; }
    }
  }
}

export { ChromeIndexedDb };
