'use strict';

/**
 * Kameras wiedererkennen.
 *
 * Jede Kamera schreibt ihre Seriennummer in die Metadaten. Daran hängen zwei
 * Dinge, die im Alltag regelmäßig schiefgehen:
 *
 *   **Wem gehört das Bild?** Auf einer gemischten Karte liegen Bilder von
 *   mehreren Leuten. Ist die Kamera einmal einer Person zugeordnet, sortiert
 *   der Import ohne Nachfragen in den richtigen Personenordner.
 *
 *   **Geht die Uhr richtig?** Eine Kamera mit falsch gestellter Uhr schiebt
 *   ihre Bilder in den falschen Tagesordner, und im Schnitt passen Foto und
 *   Video nicht zusammen. Ein Versatz je Kamera rückt das gerade, ohne die
 *   Originaldateien anzufassen.
 *
 * Die Liste steht in den Einstellungen und wird beim Import automatisch um
 * neu gesehene Kameras ergänzt — zuordnen muss man sie einmal von Hand.
 */

/** Grenzen für den Uhrzeit-Versatz: ±2 Tage decken jeden realen Fall ab. */
const MAX_VERSATZ_MINUTEN = 2 * 24 * 60;

/** Seriennummer einer Kamera aus den Metadaten — oder '' wenn sie keine schreibt. */
function seriennummer(meta) {
  const roh = (meta && (meta.SerialNumber || meta.InternalSerialNumber)) || '';
  return String(roh).trim();
}

/** Ein Schlüssel, der auch ohne Seriennummer noch etwas unterscheidet. */
function schluessel(meta) {
  const sn = seriennummer(meta);
  const modell = String((meta && meta.Model) || '').trim();
  if (sn) return sn;
  // Ohne Seriennummer bleibt nur das Modell. Das ist gröber — zwei gleiche
  // Bodies fallen zusammen —, aber besser als gar keine Zuordnung.
  return modell ? `modell:${modell}` : '';
}

/** Füllt eine von außen kommende Kameraliste auf und wirft Unbrauchbares weg. */
function normalisiereKameras(roh) {
  const gesehen = new Set();
  return (Array.isArray(roh) ? roh : [])
    .map((k) => ({
      id: String((k && k.id) || '').trim(),
      modell: String((k && k.modell) || '').trim(),
      person: String((k && k.person) || '').trim(),
      versatzMinuten: begrenzeVersatz(k && k.versatzMinuten),
      zuletzt: String((k && k.zuletzt) || ''),
    }))
    .filter((k) => {
      if (!k.id || gesehen.has(k.id)) return false;
      gesehen.add(k.id);
      return true;
    });
}

function begrenzeVersatz(wert) {
  const n = Math.round(Number(wert));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_VERSATZ_MINUTEN, Math.max(-MAX_VERSATZ_MINUTEN, n));
}

/** Sucht die Kamera zu einer Datei. */
function findeKamera(kameras, meta) {
  const id = schluessel(meta);
  if (!id) return null;
  return normalisiereKameras(kameras).find((k) => k.id === id) || null;
}

/**
 * Ergänzt die Liste um Kameras, die in den Metadaten auftauchen, aber noch
 * nicht bekannt sind. Vorhandene Einträge bleiben unverändert — eine einmal
 * getroffene Zuordnung darf ein Import nicht überschreiben.
 *
 * @returns {{kameras: object[], neu: object[]}}
 */
function ergaenzeKameras(kameras, metaListe) {
  const liste = normalisiereKameras(kameras);
  const bekannt = new Set(liste.map((k) => k.id));
  const neu = [];
  const heute = new Date().toISOString().slice(0, 10);

  for (const meta of metaListe || []) {
    const id = schluessel(meta);
    if (!id || bekannt.has(id)) continue;
    bekannt.add(id);
    const eintrag = {
      id,
      modell: String((meta && meta.Model) || '').trim(),
      person: '',
      versatzMinuten: 0,
      zuletzt: heute,
    };
    liste.push(eintrag);
    neu.push(eintrag);
  }
  return { kameras: liste, neu };
}

/**
 * Verschiebt einen Aufnahmezeitpunkt um den Versatz der Kamera.
 * Arbeitet auf dem Datumsobjekt des Imports (`{j, mo, t, hh, mi, ss}`) und
 * lässt die Datei selbst unangetastet.
 */
function wendeVersatzAn(datum, minuten) {
  const versatz = begrenzeVersatz(minuten);
  if (!datum || versatz === 0) return datum;
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date(
    Number(datum.j), Number(datum.mo) - 1, Number(datum.t),
    Number(datum.hh), Number(datum.mi), Number(datum.ss),
  );
  if (Number.isNaN(d.getTime())) return datum;
  d.setMinutes(d.getMinutes() + versatz);
  return {
    ...datum,
    j: String(d.getFullYear()),
    mo: p(d.getMonth() + 1),
    t: p(d.getDate()),
    hh: p(d.getHours()),
    mi: p(d.getMinutes()),
    ss: p(d.getSeconds()),
    datum: `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`,
  };
}

/** `90` -> `+1:30`, `-75` -> `-1:15` — für die Anzeige. */
function versatzText(minuten) {
  const n = begrenzeVersatz(minuten);
  if (n === 0) return 'keiner';
  const vz = n < 0 ? '−' : '+';
  const abs = Math.abs(n);
  return `${vz}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')} h`;
}

module.exports = {
  MAX_VERSATZ_MINUTEN,
  seriennummer,
  schluessel,
  normalisiereKameras,
  findeKamera,
  ergaenzeKameras,
  wendeVersatzAn,
  versatzText,
};
