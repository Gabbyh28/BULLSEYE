// BULLSEYE — the caller. Lines in the style of a TV darts referee, in English
// and Hebrew, built on the browser's speech voice (fx.say).
import { say } from './fx.js';

const SLANG = {
  en: { 26: 'Twenty-six. Bed and breakfast!', 45: 'Forty-five. Bag of nuts!', 3: 'Three. Ouch.' },
  he: { 26: 'עשרים ושש. לינה וארוחת בוקר!', 45: 'ארבעים וחמש. שקית אגוזים!' },
};

const isHe = (lang) => lang === 'he';

/** The maximum: one natural, emphatic line. */
export function call180(lang) {
  say(isHe(lang) ? 'מאה ושמונים!' : 'One hundred and eighty!', { interrupt: true, rate: 0.92 });
}

/** A finished turn in X01: the score, with a little colour on the famous ones. */
export function callTurnScore(points, lang) {
  if (points === 180) return call180(lang);
  if (points === 0) return say(isHe(lang) ? 'אין ניקוד' : 'No score');
  const slang = SLANG[isHe(lang) ? 'he' : 'en'][points];
  if (slang) return say(slang);
  return say(String(points), { rate: points >= 100 ? 0.95 : 1 });
}

export function callBust(lang) {
  say(isHe(lang) ? 'אין ניקוד' : 'No score', { interrupt: true });
}

/** Leg or match won; on a 170 checkout, the big fish. */
export function callGameShot({ names, matchOver, checkout, lang }) {
  const he = isHe(lang);
  if (checkout === 170) say(he ? 'הדג הגדול! מאה שבעים!' : 'The big fish! One hundred and seventy!', { interrupt: true, rate: 0.95 });
  const shot = he ? (matchOver ? `סגירה, והמשחק, ל${names}!` : `סגירה ל${names}!`) : matchOver ? `Game shot, and the match, ${names}!` : `Game shot, ${names}!`;
  say(shot, { interrupt: checkout !== 170, rate: 0.95 });
}

/** Turn start: only when a finish is on, like a TV referee ("You require 32"). */
export function callUpNext({ require, lang }) {
  if (!require) return;
  say(isHe(lang) ? `נשארו ${require}` : `You require ${require}`);
}

/** Player introduction for the start of a match. */
export function callGameOn(lang) {
  say(isHe(lang) ? 'המשחק מתחיל!' : 'Game on!', { rate: 0.95 });
}

/** Walk-on: "Introducing... Gabby!" as one natural sentence. */
export function callIntro(name, lang) {
  say(isHe(lang) ? `ועכשיו, ${name}!` : `Introducing, ${name}!`, { interrupt: true, rate: 0.95 });
}

export function callVersus(a, b, lang) {
  say(isHe(lang) ? `${a} נגד ${b}` : `${a}, versus ${b}`, { interrupt: true, rate: 0.95 });
}
