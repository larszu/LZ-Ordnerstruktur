'use strict';

const fs = require('fs');
const path = require('path');
const { planFuerVorlage } = require('./structure');
const { VORLAGE_SOLA } = require('./vorlagen');

/**
 * Legt den von {@link buildPlan} berechneten Ordnerbaum unterhalb von `zielPfad` an.
 * Bereits vorhandene Ordner werden übersprungen, nicht überschrieben – der
 * Vorgang ist damit wiederholbar (z.B. um nachträglich Namen zu ergänzen).
 *
 * @param {string} zielPfad Basisordner, den die Nutzerin / der Nutzer gewählt hat
 * @param {object} config
 * @param {object} [vorlage] Vorlage, nach der gebaut wird (Standard: Sola)
 * @returns {{erstellt: number, vorhanden: number, jahr: string, wurzel: string,
 *            warnungen: string[], fehler: Array<{pfad: string, grund: string}>}}
 */
function createStructure(zielPfad, config, vorlage = VORLAGE_SOLA) {
  const { ordner, jahr, warnungen } = planFuerVorlage(vorlage, config);
  const fehler = [];
  let erstellt = 0;
  let vorhanden = 0;

  if (!zielPfad) {
    return { erstellt, vorhanden, jahr, wurzel: '', warnungen: [...warnungen, 'Kein Zielordner gewählt.'], fehler };
  }
  if (ordner.length === 0) {
    return { erstellt, vorhanden, jahr, wurzel: '', warnungen, fehler };
  }

  const wurzel = path.join(zielPfad, ordner[0]);

  for (const relativ of ordner) {
    // Segmente einzeln zusammensetzen, damit der Trenner zur Plattform passt.
    const absolut = path.join(zielPfad, ...relativ.split('/'));
    try {
      if (fs.existsSync(absolut)) {
        vorhanden += 1;
        continue;
      }
      fs.mkdirSync(absolut, { recursive: true });
      erstellt += 1;
    } catch (err) {
      fehler.push({ pfad: absolut, grund: err.message });
    }
  }

  return { erstellt, vorhanden, jahr, wurzel, warnungen, fehler };
}

module.exports = { createStructure };
