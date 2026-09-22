'use strict';

/**
 * Erzeugt die Programmsymbole aus dem Logo der Lars Zumpe Medienproduktion.
 *
 * Quelle der Geometrie ist `01_logo/icon/lzm_icon_navy.svg` aus dem
 * LZM Brand Kit 2.0 — reine Geradenzüge, deshalb genügt ein kleiner eigener
 * Rasterer und es braucht keine Bildbibliothek.
 *
 *   node scripts/logo.js
 *
 * schreibt build/icon.png (1024), build/icon.ico und src/renderer/signet.png.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// viewBox des Originals: 429.599 359.954 331.107 331.107
const VIEW = { x: 429.599, y: 359.954, w: 331.107, h: 331.107 };

const NAVY = [0x1d, 0x32, 0x4f];
const OFFWHITE = [0xf6, 0xf5, 0xf0];
const TALLY = [0xd6, 0x40, 0x2e];

/** Die Wortmarke „lz" und der Tally-Punkt, exakt wie im Kit. */
const FORMEN = [
  {
    farbe: OFFWHITE,
    pfade: [
      [[478.128906, 595.445312], [505.285156, 455.570312], [540.207031, 455.570312], [513.046875, 595.445312]],
      [
        [638.277, 595.445], [555.828, 595.445], [561.062, 568.285], [610.922, 521.727],
        [570.183, 521.727], [575.422, 494.566], [657.871, 494.566], [652.633, 521.727],
        [602.773, 568.285], [643.515, 568.285],
      ],
    ],
  },
  {
    farbe: TALLY,
    pfade: [[[677.011, 595.445], [681.538, 565.865], [712.175, 565.865], [707.647, 595.445]]],
  },
];

/**
 * Zeichnet das Symbol in einen RGBA-Puffer.
 * @param {number} groesse Kantenlänge in Pixeln
 * @param {boolean} mitFlaeche Navy-Fläche darunter (Programmsymbol) oder frei (Signet)
 */
function zeichne(groesse, mitFlaeche) {
  const ss = 4; // vierfach überabgetastet — die schrägen Kanten bleiben sauber
  const n = groesse * ss;
  const skala = n / VIEW.w;
  const px = (p) => [(p[0] - VIEW.x) * skala, (p[1] - VIEW.y) * skala];

  // Deckungsgrad je Ziel-Pixel, getrennt nach Form
  const deckung = FORMEN.map(() => new Float32Array(groesse * groesse));

  FORMEN.forEach((form, fi) => {
    const kanten = [];
    for (const pfad of form.pfade) {
      const punkte = pfad.map(px);
      for (let i = 0; i < punkte.length; i += 1) {
        const a = punkte[i];
        const b = punkte[(i + 1) % punkte.length];
        if (a[1] !== b[1]) kanten.push([a, b]);
      }
    }
    const feld = deckung[fi];
    for (let zeile = 0; zeile < n; zeile += 1) {
      const y = zeile + 0.5;
      const schnitte = [];
      for (const [a, b] of kanten) {
        const [x1, y1] = a;
        const [x2, y2] = b;
        if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) {
          schnitte.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      schnitte.sort((p, q) => p - q);
      for (let i = 0; i + 1 < schnitte.length; i += 2) {
        const von = Math.max(0, Math.ceil(schnitte[i] - 0.5));
        const bis = Math.min(n - 1, Math.floor(schnitte[i + 1] - 0.5));
        const zielZeile = Math.floor(zeile / ss);
        for (let sp = von; sp <= bis; sp += 1) {
          feld[zielZeile * groesse + Math.floor(sp / ss)] += 1 / (ss * ss);
        }
      }
    }
  });

  const daten = Buffer.alloc(groesse * groesse * 4);
  for (let i = 0; i < groesse * groesse; i += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    if (mitFlaeche) {
      [r, g, b] = NAVY;
      a = 1;
    }
    FORMEN.forEach((form, fi) => {
      const d = Math.min(1, deckung[fi][i]);
      if (d <= 0) return;
      const neuA = d + a * (1 - d);
      r = (form.farbe[0] * d + r * a * (1 - d)) / neuA;
      g = (form.farbe[1] * d + g * a * (1 - d)) / neuA;
      b = (form.farbe[2] * d + b * a * (1 - d)) / neuA;
      a = neuA;
    });
    daten[i * 4] = Math.round(r);
    daten[i * 4 + 1] = Math.round(g);
    daten[i * 4 + 2] = Math.round(b);
    daten[i * 4 + 3] = Math.round(a * 255);
  }
  return daten;
}

/** Schreibt einen RGBA-Puffer als PNG (eine Farbe pro Kanal, keine Filter). */
function alsPng(daten, groesse) {
  const roh = Buffer.alloc((groesse * 4 + 1) * groesse);
  for (let y = 0; y < groesse; y += 1) {
    roh[y * (groesse * 4 + 1)] = 0;
    daten.copy(roh, y * (groesse * 4 + 1) + 1, y * groesse * 4, (y + 1) * groesse * 4);
  }
  const bloecke = [];
  const block = (typ, inhalt) => {
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(inhalt.length);
    const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), inhalt]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(koerper) >>> 0);
    bloecke.push(laenge, koerper, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(groesse, 0);
  ihdr.writeUInt32BE(groesse, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  block('IHDR', ihdr);
  block('IDAT', zlib.deflateSync(roh, { level: 9 }));
  block('IEND', Buffer.alloc(0));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...bloecke]);
}

const CRC_TABELLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** Packt mehrere PNGs in eine ICO-Datei (Windows liest PNG in ICO seit Vista). */
function alsIco(bilder) {
  const kopf = Buffer.alloc(6);
  kopf.writeUInt16LE(0, 0);
  kopf.writeUInt16LE(1, 2); // Typ: Symbol
  kopf.writeUInt16LE(bilder.length, 4);
  const eintraege = [];
  let offset = 6 + bilder.length * 16;
  for (const { groesse, png } of bilder) {
    const e = Buffer.alloc(16);
    e[0] = groesse >= 256 ? 0 : groesse;
    e[1] = groesse >= 256 ? 0 : groesse;
    e.writeUInt16LE(1, 4); // Farbebenen
    e.writeUInt16LE(32, 6); // Bit je Pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    eintraege.push(e);
  }
  return Buffer.concat([kopf, ...eintraege, ...bilder.map((b) => b.png)]);
}

function schreibe(ziel, inhalt) {
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, inhalt);
  console.log(`${path.relative(process.cwd(), ziel)}  (${inhalt.length} Bytes)`);
}

function main() {
  const wurzel = path.join(__dirname, '..');
  schreibe(path.join(wurzel, 'build', 'icon.png'), alsPng(zeichne(1024, true), 1024));
  schreibe(
    path.join(wurzel, 'build', 'icon.ico'),
    alsIco([16, 24, 32, 48, 64, 128, 256].map((g) => ({ groesse: g, png: alsPng(zeichne(g, true), g) }))),
  );
  // Für die Kopfzeile der App: Signet ohne Fläche, damit es auf Navy sitzt.
  schreibe(path.join(wurzel, 'src', 'renderer', 'signet.png'), alsPng(zeichne(128, false), 128));
  // Als Projektlogo im README.
  schreibe(path.join(wurzel, 'resources', 'logo.png'), alsPng(zeichne(512, true), 512));
}

if (require.main === module) main();

module.exports = { zeichne, alsPng, alsIco };
