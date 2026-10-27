'use strict';

/**
 * Die Ziele einer Sicherung: wohin eine Karte kopiert wird und welche Rolle
 * jedes Laufwerk hat.
 *
 * Die Regel am Drehtag heißt zwei Kopien, bevor die Karte gelöscht wird. Damit
 * das nicht von der Erinnerung abhängt, werden die Ziele einmal eingerichtet
 * und bei jeder Karte wieder angeboten — mit Namen, nicht als Pfad.
 *
 * Reines Modul: kein Datei- oder Kopiervorgang, nur die Liste und ihre Regeln.
 */

const path = require('path');

/** Rollen in der Reihenfolge, in der kopiert wird. */
const ROLLEN = [
  { key: 'arbeit', label: 'Arbeitslaufwerk', beschreibung: 'Hier wird geschnitten — die erste Kopie.' },
  { key: 'sicherung', label: 'Sicherung', beschreibung: 'Die zweite Kopie. Erst wenn sie steht, darf die Karte gelöscht werden.' },
  { key: 'archiv', label: 'Archiv', beschreibung: 'Langfristige Ablage, oft erst später angeschlossen.' },
];

const ROLLEN_KEYS = ROLLEN.map((r) => r.key);
const MAX_ZIELE = 6;

/** Beschriftung einer Rolle; unbekannte Rolle gilt als Sicherung. */
function rolleLabel(key) {
  const r = ROLLEN.find((x) => x.key === key);
  return r ? r.label : 'Sicherung';
}

/** Vorschlag für den Anzeigenamen eines Pfades: der Name des Laufwerks. */
function nameFuerPfad(pfad) {
  const sauber = String(pfad || '').replace(/[/\\]+$/, '');
  if (!sauber) return '';
  if (/^\/Volumes\/[^/]+$/.test(sauber)) return path.basename(sauber);
  return path.basename(sauber) || sauber;
}

/**
 * Bringt eine gespeicherte Liste in Form: Pfad als Pflichtfeld, bekannte Rolle,
 * keine Doppelten, höchstens {@link MAX_ZIELE} Einträge.
 * @param {Array} liste
 * @returns {Array<{pfad: string, name: string, rolle: string, aktiv: boolean}>}
 */
function normalisiereZiele(liste) {
  const out = [];
  const gesehen = new Set();
  for (const roh of Array.isArray(liste) ? liste : []) {
    if (!roh || typeof roh !== 'object') continue;
    const pfad = String(roh.pfad || '').trim();
    if (!pfad || gesehen.has(pfad)) continue;
    gesehen.add(pfad);
    out.push({
      pfad,
      name: String(roh.name || '').trim() || nameFuerPfad(pfad),
      rolle: ROLLEN_KEYS.includes(roh.rolle) ? roh.rolle : 'sicherung',
      aktiv: roh.aktiv !== false,
    });
    if (out.length >= MAX_ZIELE) break;
  }
  // Nach Rolle sortieren: Arbeitslaufwerk zuerst, dann Sicherung, dann Archiv.
  return out.sort((a, b) => ROLLEN_KEYS.indexOf(a.rolle) - ROLLEN_KEYS.indexOf(b.rolle));
}

/** Nimmt ein Ziel auf. Ein schon bekannter Pfad wird aktualisiert, nicht verdoppelt. */
function ergaenzeZiel(ziele, { pfad, name, rolle } = {}) {
  const sauber = String(pfad || '').trim();
  if (!sauber) return { ziele: normalisiereZiele(ziele), neu: false, fehler: 'Kein Pfad angegeben.' };
  const vorhanden = normalisiereZiele(ziele);
  const treffer = vorhanden.find((z) => z.pfad === sauber);
  if (treffer) {
    if (name) treffer.name = String(name).trim();
    if (rolle) treffer.rolle = ROLLEN_KEYS.includes(rolle) ? rolle : treffer.rolle;
    treffer.aktiv = true;
    return { ziele: normalisiereZiele(vorhanden), neu: false };
  }
  if (vorhanden.length >= MAX_ZIELE) {
    return { ziele: vorhanden, neu: false, fehler: `Mehr als ${MAX_ZIELE} Ziele werden nicht verwaltet.` };
  }
  // Ohne Angabe ist das erste Ziel das Arbeitslaufwerk, jedes weitere eine Sicherung.
  const gewaehlt = ROLLEN_KEYS.includes(rolle) ? rolle : (vorhanden.length === 0 ? 'arbeit' : 'sicherung');
  return {
    ziele: normalisiereZiele([...vorhanden, { pfad: sauber, name, rolle: gewaehlt, aktiv: true }]),
    neu: true,
  };
}

/** Ändert Name, Rolle oder Häkchen eines Ziels. */
function setzeZiel(ziele, pfad, aenderungen = {}) {
  const liste = normalisiereZiele(ziele).map((z) => (z.pfad === pfad ? { ...z, ...aenderungen, pfad: z.pfad } : z));
  return normalisiereZiele(liste);
}

/** Entfernt ein Ziel aus der Liste (die Dateien darauf bleiben unberührt). */
function entferneZiel(ziele, pfad) {
  return normalisiereZiele(normalisiereZiele(ziele).filter((z) => z.pfad !== pfad));
}

/**
 * Ergänzt jedes Ziel um seinen Stand: angeschlossen oder nicht, freier Platz.
 * @param {Array} ziele
 * @param {(pfad: string) => {vorhanden: boolean, frei: number|null, gesamt: number|null}} stand
 */
function mitStand(ziele, stand) {
  return normalisiereZiele(ziele).map((z) => {
    const s = stand ? stand(z.pfad) : { vorhanden: false, frei: null, gesamt: null };
    return {
      ...z,
      rolleLabel: rolleLabel(z.rolle),
      angeschlossen: Boolean(s.vorhanden),
      frei: s.frei,
      gesamt: s.gesamt,
    };
  });
}

/** Die Ziele, auf die jetzt wirklich kopiert werden kann. */
function einsatzbereit(zieleMitStand) {
  return (zieleMitStand || []).filter((z) => z.aktiv && z.angeschlossen);
}

/**
 * Sagt im Klartext, ob die Zwei-Kopien-Regel erfüllbar ist. Kein Verbot — wer
 * nur ein Ziel hat, darf kopieren, muss es aber gelesen haben.
 * @returns {{bereit: Array, fehlen: Array, hinweis: string}}
 */
function pruefeAufstellung(zieleMitStand) {
  const alle = zieleMitStand || [];
  const bereit = einsatzbereit(alle);
  const fehlen = alle.filter((z) => z.aktiv && !z.angeschlossen);
  let hinweis = '';
  if (alle.length === 0) {
    hinweis = 'Noch kein Ziel eingerichtet — ohne Ziel kann nichts gesichert werden.';
  } else if (bereit.length === 0) {
    hinweis = 'Kein Ziel angeschlossen. Platte anstecken, dann erneut prüfen.';
  } else if (bereit.length === 1) {
    hinweis = fehlen.length > 0
      ? `Nur ${bereit[0].name} ist da — ${fehlen.map((z) => z.name).join(', ')} fehlt. Eine Kopie ist keine Sicherung.`
      : 'Nur ein Ziel angeschlossen. Eine Kopie ist keine Sicherung — zweites Ziel anstecken.';
  } else {
    hinweis = `${bereit.length} Ziele bereit: ${bereit.map((z) => z.name).join(', ')}.`;
  }
  return { bereit, fehlen, hinweis };
}

/** Bytes in eine lesbare Angabe — für Oberfläche und Protokoll gleich. */
function lesbareGroesse(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '—';
  const n = Number(bytes);
  const einheiten = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let wert = n;
  while (wert >= 1024 && i < einheiten.length - 1) {
    wert /= 1024;
    i += 1;
  }
  const stellen = wert < 10 && i > 0 ? 1 : 0;
  return `${wert.toFixed(stellen).replace('.', ',')} ${einheiten[i]}`;
}

module.exports = {
  ROLLEN,
  ROLLEN_KEYS,
  MAX_ZIELE,
  rolleLabel,
  nameFuerPfad,
  normalisiereZiele,
  ergaenzeZiel,
  setzeZiel,
  entferneZiel,
  mitStand,
  einsatzbereit,
  pruefeAufstellung,
  lesbareGroesse,
};
