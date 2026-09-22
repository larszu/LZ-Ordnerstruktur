'use strict';

/**
 * Die Sola-Sicht auf die Vorlagen-Maschine.
 *
 * Der eigentliche Ordnerbau steht in `vorlagen.js` und arbeitet mit beliebigen
 * Vorlagen. Diese Datei hält die gewohnten Sola-Namen (SOLAS, BEREICHE,
 * `buildPlan`) bereit — davon leben die CSV-Kompatibilität zum Windows-Original
 * und die Tests.
 */

const { solaJahr, SOLA_TAGE } = require('./dates');
const vorlagen = require('./vorlagen');

const SOLA = vorlagen.VORLAGE_SOLA;

/** Die Solas, die sich anlegen lassen. */
const SOLAS = SOLA.projekte.map((p) => ({ ...p }));

/** Die acht Bereiche in der Reihenfolge, in der sie durchnummeriert werden. */
const BEREICHE = SOLA.bereiche.map((b) => ({ key: b.key, label: b.label }));

const fotoBereich = SOLA.bereiche.find((b) => b.key === 'foto');
const videoBereich = SOLA.bereiche.find((b) => b.key === 'video');

/** Unterordner, die jede Fotografin / jeder Fotograf pro Tag bekommt. */
const FOTO_UNTERORDNER = [...fotoBereich.personenUnterordner];

/** Feste Ordner, die in jedem Tagesordner unterhalb von `NN_Foto` liegen. */
const FOTO_TAG_ORDNER = (tag) => fotoBereich.tagUnterordner.map((m) => vorlagen.fuelleMuster(m, { nr: tag, tag }));

/** Feste Ordner, die in jedem Tagesordner unterhalb von `NN_Video` liegen. */
const VIDEO_TAG_ORDNER = [...videoBereich.tagUnterordner];

const LR_KATALOGE = fotoBereich.festeOrdner[0].name;

/**
 * @typedef {Object} SolaAuswahl
 * @property {boolean} aktiv       Sola überhaupt angewählt
 * @property {string}  start       Startdatum als `yyyy-MM-dd`
 * @property {number}  tage        Dauer in Tagen (1–31)
 * @property {Object<string, boolean>} bereiche  Anwahl je Bereich (siehe BEREICHE)
 * @property {string[]} fotografen Bis zu 10 Namen
 * @property {string[]} videografen Bis zu 10 Namen
 */

/**
 * @typedef {Object} Config
 * @property {string} [jahr]  Solajahr; leer = automatisch aus den Startdaten
 * @property {SolaAuswahl} teens
 * @property {SolaAuswahl} kids
 * @property {SolaAuswahl} sofa
 * @property {SolaAuswahl} next
 */

/**
 * Ermittelt das Jahr einer Konfiguration: entweder von Hand eingetragen oder
 * aus den Startdaten der angewählten Projekte.
 *
 * @param {object} cfg          bereits normalisierte Konfiguration
 * @param {object} vorlage      normalisierte Vorlage
 * @returns {{jahr: string, warnung: string}}
 */
function bestimmeJahr(cfg, vorlage) {
  if (!vorlage.jahrNutzen) return { jahr: '', warnung: '' };
  const auto = solaJahr(
    vorlage.projekte.filter((p) => cfg[p.key].aktiv).map((p) => ({ label: p.label, start: cfg[p.key].start })),
  );
  const jahr = String(cfg.jahr || auto.jahr || '').trim();
  if (jahr) return { jahr, warnung: '' };
  return {
    jahr: '',
    warnung: auto.conflict
      ? `${auto.jahre.map((e) => `${e.label} (${e.jahr})`).join(', ')} liegen in verschiedenen Jahren – bitte das Jahr manuell angeben.`
      : 'Kein Jahr ermittelbar – bitte Startdatum wählen oder das Jahr manuell angeben.',
  };
}

/**
 * Baut den Ordnerbaum einer beliebigen Vorlage.
 * @param {object} vorlage
 * @param {object} config
 * @returns {{ordner: string[], jahr: string, wurzel: string, warnungen: string[]}}
 */
function planFuerVorlage(vorlage, config) {
  const v = vorlagen.normalisiereVorlage(vorlage);
  const cfg = vorlagen.normalisiereConfig(config, v);
  const { jahr, warnung } = bestimmeJahr(cfg, v);
  if (warnung) return { ordner: [], jahr: '', wurzel: '', warnungen: [warnung] };

  const ergebnis = vorlagen.baueOrdner(v, cfg, { jahr });
  return { ordner: ergebnis.ordner, jahr, wurzel: ergebnis.wurzel, warnungen: ergebnis.warnungen };
}

/**
 * Baut den Sola-Ordnerbaum als flache, sortierte Liste relativer Pfade.
 * @param {Config} config
 * @returns {{ordner: string[], jahr: string, warnungen: string[]}}
 */
function buildPlan(config) {
  const { ordner, jahr, warnungen } = planFuerVorlage(SOLA, config);
  return { ordner, jahr, warnungen };
}

/**
 * Ermittelt für eine Person je Solatag den Zielordner, in den ihre Fotos bzw.
 * Videos importiert werden.
 *
 * @param {Config} config
 * @param {{solaKey: string, bereich: 'foto'|'video', person: string}} auswahl
 * @returns {{jahr: string, sola: string, person: string|null,
 *            ziele: Object<string, string>, warnungen: string[]}}
 */
function importZielordner(config, auswahl) {
  const ergebnis = zielordnerFuerVorlage(SOLA, config, {
    projektKey: auswahl.solaKey,
    bereich: auswahl.bereich,
    person: auswahl.person,
  });
  return { jahr: ergebnis.jahr, sola: ergebnis.projekt, person: ergebnis.person, ziele: ergebnis.ziele, warnungen: ergebnis.warnungen };
}

/** Wie {@link importZielordner}, aber für eine beliebige Vorlage. */
function zielordnerFuerVorlage(vorlage, config, auswahl) {
  const v = vorlagen.normalisiereVorlage(vorlage);
  const cfg = vorlagen.normalisiereConfig(config, v);
  const { jahr, warnung } = bestimmeJahr(cfg, v);
  if (warnung) return { jahr: '', projekt: '', person: null, ziele: {}, warnungen: [warnung] };

  const ergebnis = vorlagen.importZiele(v, cfg, { ...auswahl, jahr });
  return { jahr, ...ergebnis };
}

/** Füllt fehlende Felder auf und normalisiert die Namenslisten. */
function normalizeConfig(config, vorlage = SOLA) {
  return vorlagen.normalisiereConfig(config, vorlage);
}

/** Leere Konfiguration – Ausgangspunkt für die Oberfläche und für Tests. */
function emptyConfig(vorlage = SOLA) {
  return vorlagen.leereConfig(vorlage);
}

module.exports = {
  SOLAS,
  BEREICHE,
  FOTO_UNTERORDNER,
  FOTO_TAG_ORDNER,
  VIDEO_TAG_ORDNER,
  LR_KATALOGE,
  SOLA_TAGE,
  buildPlan,
  planFuerVorlage,
  importZielordner,
  zielordnerFuerVorlage,
  bestimmeJahr,
  normalizeConfig,
  emptyConfig,
};
