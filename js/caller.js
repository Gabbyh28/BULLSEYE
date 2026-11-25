// BULLSEYE — the caller. Lines in the style of a TV darts referee, in English
// and Hebrew, built on the browser's speech voice (fx.say).
import { say } from './fx.js';

const SLANG = {
  en: { 26: 'Twenty-six. Bed and breakfast!', 45: 'Forty-five. Bag of nuts!', 3: 'Three. Ouch.' },
  he: { 26: 'עשרים ושש. לינה וארוחת בוקר!', 45: 'ארבעים וחמש. שקית אגוזים!' },
};

const isHe = (lang) => lang === 'he';

/** The stretched maximum. */
export function call180(lang) {
  if (isHe(lang)) {
    say('מאה ו', { interrupt: true, rate: 0.95, pitch: 1.05 });
    say('שמונים!', { rate: 0.55, pitch: 1.3 });
  } else {
    say('One hundred and', { interrupt: true, rate: 0.95, pitch: 1.05 });
    say('eighty!', { rate: 0.5, pitch: 1.35 });
  }
}

/** A finished turn in X01: the score, with a little colour on the famous ones. */
export function callTurnScore(points, lang) {
  if (points === 180) return call180(lang);
  if (points === 0) return say(isHe(lang) ? 'אין ניקוד' : 'No score');
  const slang = SLANG[isHe(lang) ? 'he' : 'en'][points];
  if (slang) return say(slang);
  if (points >= 100) return say(String(points), { rate: 0.85, pitch: 1.12 });
  return say(String(points));
}

export function callBust(lang) {
  say(isHe(lang) ? 'אין ניקוד' : 'No score', { interrupt: true, rate: 0.9 });
}

/** Leg or match won; on a 170 checkout, the big fish. */
export function callGameShot({ names, matchOver, checkout, lang }) {
  const he = isHe(lang);
  if (checkout === 170) say(he ? 'הדג הגדול! מאה שבעים!' : 'The big fish! One hundred and seventy!', { interrupt: true, rate: 0.9, pitch: 1.15 });
  const shot = he ? (matchOver ? 'סגירה, והמשחק!' : 'סגירה!') : matchOver ? 'Game shot, and the match!' : 'Game shot!';
  say(shot, { interrupt: checkout !== 170, rate: 0.85, pitch: 1.15 });
  say(he ? `${names} ניצח` : `${names}!`, { rate: 0.95 });
}

/** Turn start: "Gabby, you require 32." */
export function callUpNext({ name, require, lang }) {
  const he = isHe(lang);
  if (require) say(he ? `${name}, נשארו לך ${require}` : `${name}, you require ${require}`);
  else say(he ? `התור של ${name}` : name);
}

/** Player introduction for the start of a match. */
export function callGameOn(lang) {
  say(isHe(lang) ? 'המשחק מתחיל!' : 'Game on!', { rate: 0.9, pitch: 1.1 });
}
