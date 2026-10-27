'use strict';

/* global lz */
// Hell, dunkel oder wie das System — in jedem Fenster derselbe Schalter.
//
// Die Wahl liegt in den Einstellungen der App, nicht im Browserspeicher: Sie
// gilt dann für alle drei Fenster und überlebt einen Neustart. Bis sie gelesen
// ist, folgt die Oberfläche dem System.

const THEMEN = ['auto', 'hell', 'dunkel'];

/** Setzt das Thema am Dokument und markiert den Schalter. */
function setzeThema(wahl) {
  const gewaehlt = THEMEN.includes(wahl) ? wahl : 'auto';
  const wurzel = document.documentElement;
  if (gewaehlt === 'auto') delete wurzel.dataset.theme;
  else wurzel.dataset.theme = gewaehlt === 'dunkel' ? 'dark' : 'light';
  for (const knopf of document.querySelectorAll('.themen button')) {
    knopf.setAttribute('aria-pressed', String(knopf.dataset.thema === gewaehlt));
  }
  return gewaehlt;
}

/**
 * Verdrahtet den Schalter und stellt das gemerkte Thema her.
 * @param {string} [vorgabe] schon bekanntes Thema (spart einen IPC-Aufruf)
 * @param {(wahl: string) => void} [beiWechsel] damit ein Fenster seinen eigenen
 *   Einstellungsstand mitführen kann — sonst schreibt es später die alte Wahl
 *   zurück.
 */
async function themaStarten(vorgabe, beiWechsel) {
  let wahl = vorgabe;
  if (!wahl) {
    try {
      wahl = await lz.themaLesen();
    } catch (_) {
      wahl = 'auto';
    }
  }
  setzeThema(wahl);
  for (const knopf of document.querySelectorAll('.themen button')) {
    knopf.addEventListener('click', () => {
      const neu = setzeThema(knopf.dataset.thema);
      lz.themaSchreiben(neu);
      if (beiWechsel) beiWechsel(neu);
    });
  }
  // Ein anderes Fenster hat umgeschaltet.
  lz.aufThema((neu) => {
    setzeThema(neu);
    if (beiWechsel) beiWechsel(neu);
  });
}
