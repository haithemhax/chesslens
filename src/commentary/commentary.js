import { COMMENTARY_TEMPLATES } from './templates.js';
import { translate } from '../i18n/translations.js';
import { evalToWinProb, formatEval, mateForMover } from '../lib/evaluation.js';
import { uciToSan } from '../lib/chessHelpers.js';

export const OPENINGS = [
  { sequence: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], name: { en: 'Ruy Lopez', fr: 'Partie Espagnole', ar: 'افتتاح روي لوبيز' } },
  { sequence: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: { en: 'Italian Game', fr: 'Partie Italienne', ar: 'الدور الإيطالي' } },
  { sequence: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'], name: { en: 'Scotch Game', fr: 'Partie Écossaise', ar: 'الدور الإسكتلندي' } },
  { sequence: ['e4', 'e5', 'Nf3', 'Nf6'], name: { en: 'Petrov’s Defense', fr: 'Défense Petrov', ar: 'دفاع بتروف' } },
  { sequence: ['e4', 'e5', 'f4'], name: { en: 'King’s Gambit', fr: 'Gambit du Roi', ar: 'جامبت الملك' } },
  { sequence: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], name: { en: 'Sicilian Najdorf', fr: 'Sicilienne Najdorf', ar: 'صقلي نايدورف' } },
  { sequence: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4'], name: { en: 'Open Sicilian', fr: 'Sicilienne Ouverte', ar: 'الدفاع الصقلي المفتوح' } },
  { sequence: ['e4', 'c5'], name: { en: 'Sicilian Defense', fr: 'Défense Sicilienne', ar: 'الدفاع الصقلي' } },
  { sequence: ['e4', 'e6', 'd4', 'd5'], name: { en: 'French Defense', fr: 'Défense Française', ar: 'الدفاع الفرنسي' } },
  { sequence: ['e4', 'e6'], name: { en: 'French Defense', fr: 'Défense Française', ar: 'الدفاع الفرنسي' } },
  { sequence: ['e4', 'c6', 'd4', 'd5'], name: { en: 'Caro-Kann Defense', fr: 'Défense Caro-Kann', ar: 'دفاع كارو-كان' } },
  { sequence: ['e4', 'c6'], name: { en: 'Caro-Kann Defense', fr: 'Défense Caro-Kann', ar: 'دفاع كارو-كان' } },
  { sequence: ['e4', 'd5'], name: { en: 'Scandinavian Defense', fr: 'Défense Scandinave', ar: 'الدفاع الإسكندنافي' } },
  { sequence: ['e4', 'd6'], name: { en: 'Pirc Defense', fr: 'Défense Pirc', ar: 'دفاع بيرك' } },
  { sequence: ['e4', 'Nf6'], name: { en: 'Alekhine’s Defense', fr: 'Défense Alekhine', ar: 'دفاع أليخين' } },
  { sequence: ['d4', 'd5', 'c4', 'e6'], name: { en: 'Queen’s Gambit Declined', fr: 'Gambit Dame Refusé', ar: 'جامبت الوزير المرفوض' } },
  { sequence: ['d4', 'd5', 'c4', 'c6'], name: { en: 'Slav Defense', fr: 'Défense Slave', ar: 'الدفاع السلافي' } },
  { sequence: ['d4', 'd5', 'c4', 'dxc4'], name: { en: 'Queen’s Gambit Accepted', fr: 'Gambit Dame Accepté', ar: 'جامبت الوزير المقبول' } },
  { sequence: ['d4', 'd5', 'c4'], name: { en: 'Queen’s Gambit', fr: 'Gambit Dame', ar: 'جامبت الوزير' } },
  { sequence: ['d4', 'Nf6', 'c4', 'g6'], name: { en: 'King’s Indian Defense', fr: 'Défense Est-Indienne', ar: 'دفاع الملك الهندي' } },
  { sequence: ['d4', 'Nf6', 'c4', 'e6'], name: { en: 'Nimzo / Indian Defense', fr: 'Défense Indienne', ar: 'الدفاع الهندي' } },
  { sequence: ['d4', 'f5'], name: { en: 'Dutch Defense', fr: 'Défense Hollandaise', ar: 'الدفاع الهولندي' } },
  { sequence: ['c4'], name: { en: 'English Opening', fr: 'Ouverture Anglaise', ar: 'الافتتاح الإنجليزي' } },
  { sequence: ['Nf3'], name: { en: 'Réti Opening', fr: 'Ouverture Réti', ar: 'افتتاح ريتي' } },
  { sequence: ['f4'], name: { en: 'Bird’s Opening', fr: 'Ouverture Bird', ar: 'افتتاح بيرد' } },
];

function matchOpening(sans) {
  if (!sans || sans.length === 0 || sans.length > 10) return null;
  for (const item of OPENINGS) {
    if (item.sequence.length === sans.length) {
      const matches = item.sequence.every((s, i) => s === sans[i]);
      if (matches) return item;
    }
  }
  return null;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function pick(list, seed) {
  if (!list || !list.length) return '';
  return list[hashString(seed) % list.length];
}

function missingPlaceholders(template, context) {
  const matches = template.matchAll(/\{(\w+)\}/g);
  for (const match of matches) {
    const value = context[match[1]];
    if (value === undefined || value === null || value === '') return true;
  }
  return false;
}

function fill(template, context) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => context[key] ?? '');
}

function pickValid(list, seed, context, usedSentences = null) {
  const valid = (list || []).filter((template) => !missingPlaceholders(template, context));
  const pool = valid.length ? valid : list;
  if (!pool || !pool.length) return '';

  // 10-move anti-repetition memory window: avoid reusing identical sentences
  if (usedSentences && usedSentences.size > 0) {
    const fresh = pool.filter((tpl) => !usedSentences.has(fill(tpl, context)));
    if (fresh.length > 0) {
      return pick(fresh, seed);
    }
  }

  return pick(pool, seed);
}

function numberFormat(lang) {
  const locale = lang === 'ar' ? 'ar-EG' : lang === 'fr' ? 'fr-FR' : 'en-US';
  return new Intl.NumberFormat(locale);
}

/**
 * Build a template commentary line for one move. Always synchronous and
 * offline; the optional LLM layer may replace it later.
 */
export function makeCommentary(record, lang, previousMoves = []) {
  const templates = COMMENTARY_TEMPLATES[lang] || COMMENTARY_TEMPLATES.en;
  const rtl = lang === 'ar';
  const isolate = (value) => (rtl && value ? `\u2066${value}\u2069` : String(value ?? ''));
  const nf = numberFormat(lang);
  const pieces = templates.pieces;

  // Track recent phrases from the last 10 moves to prevent repetitions
  const recentWindow = Array.isArray(previousMoves) ? previousMoves.slice(-10) : [];
  const usedSentences = new Set(
    recentWindow.map((m) => m?.commentaryText).filter(Boolean),
  );

  const mover = translate(lang, record.color === 'w' ? 'white' : 'black');
  const winner = record.gameOver?.winner
    ? translate(lang, record.gameOver.winner === 'w' ? 'white' : 'black')
    : '';
  const loser = record.gameOver?.winner
    ? translate(lang, record.gameOver.winner === 'w' ? 'black' : 'white')
    : '';

  const mateN = record.evalAfter ? mateForMover(record.evalAfter, record.color) : null;
  const beforeProb = record.evalBefore ? evalToWinProb(record.evalBefore) : null;
  const afterProb = record.evalAfter ? evalToWinProb(record.evalAfter) : null;
  const moverProbBefore = beforeProb == null ? null : record.color === 'w' ? beforeProb : 100 - beforeProb;
  const moverProbAfter = afterProb == null ? null : record.color === 'w' ? afterProb : 100 - afterProb;
  const swing = moverProbBefore != null && moverProbAfter != null
    ? Math.max(0, Math.round(moverProbBefore - moverProbAfter))
    : null;
  const bestSan = record.bestMoveBefore ? uciToSan(record.fenBefore, record.bestMoveBefore) : null;

  // Opening recognition
  const allSans = [...recentWindow.map((m) => m?.san).filter(Boolean), record.san];
  const matchedOpeningObj = matchOpening(allSans);
  const matchedOpening = matchedOpeningObj ? (matchedOpeningObj.name[lang] || matchedOpeningObj.name.en) : '';

  // Situational detection
  const previousRecord = previousMoves && previousMoves.length > 0 ? previousMoves[previousMoves.length - 1] : null;
  const isRecapture = Boolean(
    previousRecord && previousRecord.to === record.to && previousRecord.captured && record.captured,
  );
  const isExchangeSac = Boolean(
    record.piece === 'r'
      && (record.captured === 'n' || record.captured === 'b')
      && record.verdict !== 'blunder'
      && record.verdict !== 'mistake',
  );
  const rank = record.to?.[1];
  const isBackRank = (record.color === 'w' && rank === '8' && (record.piece === 'r' || record.piece === 'q'))
    || (record.color === 'b' && rank === '1' && (record.piece === 'r' || record.piece === 'q'));
  const isBackRankThreat = isBackRank && record.san.includes('+');

  const context = {
    mover,
    winner,
    loser,
    san: isolate(record.san),
    from: isolate(record.from),
    to: isolate(record.to),
    piece: pieces[record.piece] || record.piece,
    captured: record.captured ? pieces[record.captured] : '',
    promotion: record.promotion ? pieces[record.promotion] : '',
    swing: swing != null ? nf.format(swing) : '',
    n: mateN != null && mateN > 0 ? nf.format(mateN) : '',
    bestSan: bestSan ? isolate(bestSan) : '',
    opening: matchedOpening ? isolate(matchedOpening) : '',
  };

  const seed = `${record.ply}-${record.san}-${lang}`;
  const resultType = record.gameOver?.over ? record.gameOver.type : null;

  if (resultType === 'checkmate') {
    return fill(pickValid(templates.checkmate, `${seed}-mate`, context, usedSentences), context);
  }
  if (resultType === 'stalemate') {
    return fill(pickValid(templates.stalemate, `${seed}-stale`, context, usedSentences), context);
  }
  if (resultType) {
    const reasonKey = ['repetition', 'material', 'fifty'].includes(resultType) ? resultType : 'draw';
    const reason = translate(lang, `result.${reasonKey}`);
    return `${reason}. ${fill(pickValid(templates.draw, `${seed}-draw`, context, usedSentences), context)}`;
  }

  // Description sentence priority: opening > recapture > exchangeSac > backRank > promotion > castle > check > capture > generic
  let descriptionKey = 'generic';
  if (matchedOpening && templates.opening) {
    descriptionKey = 'opening';
  } else if (isRecapture && templates.recapture) {
    descriptionKey = 'recapture';
  } else if (isExchangeSac && templates.exchangeSacrifice) {
    descriptionKey = 'exchangeSacrifice';
  } else if (isBackRankThreat && templates.backRankThreat) {
    descriptionKey = 'backRankThreat';
  } else if (record.promotion) {
    descriptionKey = 'promotion';
  } else if (record.flags.includes('k') || record.flags.includes('q')) {
    descriptionKey = 'castle';
  } else if (record.san.includes('+')) {
    descriptionKey = 'check';
  } else if (record.flags.includes('c') || record.flags.includes('e')) {
    descriptionKey = 'capture';
  }

  const description = fill(pickValid(templates[descriptionKey], `${seed}-${descriptionKey}`, context, usedSentences), context);

  // Reaction sentence
  let reaction = '';
  if (record.verdict === 'brilliant') {
    reaction = fill(pickValid(templates.brilliant, `${seed}-brilliant`, context, usedSentences), context);
  } else if (mateN != null && mateN > 0 && ['best', 'excellent', 'good'].includes(record.verdict)) {
    reaction = fill(pickValid(templates.mateThreat, `${seed}-mating`, context, usedSentences), context);
  } else if (record.verdict && templates[record.verdict]) {
    reaction = fill(pickValid(templates[record.verdict], `${seed}-${record.verdict}`, context, usedSentences), context);
  }

  return [description, reaction].filter(Boolean).join(' ');
}

export function makeGameStartCommentary(lang) {
  const templates = COMMENTARY_TEMPLATES[lang] || COMMENTARY_TEMPLATES.en;
  return pick(templates.gameStart, `start-${lang}`);
}

/** Compact, model-friendly context for the optional online commentary. */
export function buildLlmContext(record) {
  return {
    move: record.san,
    mover: record.color === 'w' ? 'White' : 'Black',
    verdict: record.verdict,
    centipawnLoss: record.cpLoss,
    evalBefore: formatEval(record.evalBefore),
    evalAfter: formatEval(record.evalAfter),
    engineBestMove: record.bestMoveBefore || null,
    sacrifice: Boolean(record.sacrifice),
    gameOver: record.gameOver?.over ? record.gameOver : null,
    ply: record.ply,
  };
}

export function localizedVerdict(lang, verdict) {
  return verdict ? translate(lang, `verdict.${verdict}`) : '';
}
