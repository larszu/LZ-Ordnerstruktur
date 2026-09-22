'use strict';

/**
 * Eigene Vorlagen liegen als JSON im Benutzerdatenordner und überleben damit
 * ein Update der App. Die mitgelieferten Vorlagen sind schreibgeschützt; wer
 * eine davon ändert, legt automatisch eine eigene Kopie an.
 */

const fs = require('fs');
const path = require('path');
const { eingebauteVorlagen, normalisiereVorlage } = require('./vorlagen');

/** Macht aus einem Namen einen Dateinamen ohne Überraschungen. */
function alsId(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'vorlage';
}

/** Liest alle eigenen Vorlagen aus `userDir`. */
function eigeneVorlagen(userDir) {
  if (!userDir || !fs.existsSync(userDir)) return [];
  const vorlagen = [];
  for (const datei of fs.readdirSync(userDir).sort()) {
    if (!datei.endsWith('.json')) continue;
    try {
      const roh = JSON.parse(fs.readFileSync(path.join(userDir, datei), 'utf8'));
      vorlagen.push({ ...normalisiereVorlage(roh), id: path.basename(datei, '.json'), eingebaut: false });
    } catch (_) {
      // Eine kaputte Datei darf die Liste nicht sprengen.
    }
  }
  return vorlagen;
}

/**
 * Alle verfügbaren Vorlagen: erst die mitgelieferten, dann die eigenen.
 * Eine eigene Vorlage mit der Id einer mitgelieferten ersetzt diese.
 */
function listeVorlagen(userDir) {
  const eigen = eigeneVorlagen(userDir);
  const eigeneIds = new Set(eigen.map((v) => v.id));
  const eingebaut = eingebauteVorlagen().filter((v) => !eigeneIds.has(v.id));
  return [...eingebaut, ...eigen];
}

/** Eine Vorlage nach Id — oder die erste, wenn die Id unbekannt ist. */
function findeVorlage(userDir, id) {
  const alle = listeVorlagen(userDir);
  return alle.find((v) => v.id === id) || alle[0] || null;
}

/**
 * Speichert eine Vorlage. Ohne `id` entsteht eine neue aus dem Namen; eine
 * schon vergebene Id wird durchnummeriert.
 *
 * @returns {{ok: boolean, id?: string, grund?: string, vorlagen: object[]}}
 */
function speichereVorlage(userDir, roh, { neu = false } = {}) {
  try {
    fs.mkdirSync(userDir, { recursive: true });
    const vorlage = normalisiereVorlage(roh);
    let id = neu || !roh.id ? alsId(vorlage.name) : String(roh.id);
    if (neu) {
      const vergeben = new Set(listeVorlagen(userDir).map((v) => v.id));
      let n = 2;
      const basis = id;
      while (vergeben.has(id)) id = `${basis}-${n++}`;
    }
    const daten = { ...vorlage, id, eingebaut: false };
    fs.writeFileSync(path.join(userDir, `${id}.json`), `${JSON.stringify(daten, null, 2)}\n`, 'utf8');
    return { ok: true, id, vorlagen: listeVorlagen(userDir) };
  } catch (err) {
    return { ok: false, grund: err.message, vorlagen: listeVorlagen(userDir) };
  }
}

/**
 * Löscht eine eigene Vorlage. Verdeckte sie eine mitgelieferte, gilt danach
 * wieder die mitgelieferte.
 */
function loescheVorlage(userDir, id) {
  const datei = path.join(userDir, `${String(id || '').replace(/[^a-z0-9-]/gi, '')}.json`);
  try {
    if (!fs.existsSync(datei)) {
      return { ok: false, grund: 'Mitgelieferte Vorlagen lassen sich nicht löschen.', vorlagen: listeVorlagen(userDir) };
    }
    fs.unlinkSync(datei);
    return { ok: true, vorlagen: listeVorlagen(userDir) };
  } catch (err) {
    return { ok: false, grund: err.message, vorlagen: listeVorlagen(userDir) };
  }
}

module.exports = { alsId, listeVorlagen, eigeneVorlagen, findeVorlage, speichereVorlage, loescheVorlage };
