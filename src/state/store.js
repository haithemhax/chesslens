import { create } from 'zustand';
import { Chess } from 'chess.js';
import {
  evalFromMaterial,
  evalToWinProb,
  gameResult,
  MATE_CP,
} from '../lib/evaluation.js';
import { classifyMove } from '../lib/classification.js';
import {
  makeCommentary,
  makeGameStartCommentary,
} from '../commentary/commentary.js';
import { DEFAULT_LANG, hasLanguage, LANGUAGES } from '../i18n/translations.js';
import { loadCalibration, loadSettings } from '../lib/storage.js';

export const START_FEN = new Chess().fen();

const DEFAULT_SETTINGS = {
  lang: DEFAULT_LANG,
  engineMs: 600,
  skillLevel: 20,
  flip: false,
  detectionPaused: false,
  motionSensitivity: 1,
  settleMs: 400,
  deviceId: '',
  promotionChoice: 'q',
  eventName: 'Live Chess Show',
  whitePlayer: 'Grandmaster White',
  blackPlayer: 'Grandmaster Black',
  showIntroScreen: false,
  cameraBgMode: 'background',
  cameraBgOpacity: 35,
  cameraBgBlur: 6,
  cameraBgBrightness: 100,
  cameraBgMirror: false,
  cameraBgRotate: 0,
  cameraBgPerfMode: false,
  cameraPanelShow: true,
  cameraPanelSource: 'raw',
  cameraPanelMirror: false,
  cameraPanelRotate: 0,
  cameraPanelSize: 'medium',
  recordingBitrate: 4,
  recordingSegmentMinutes: 10,
  recordingSource: 'camera',
  llmEnabled: false,
  llmBaseUrl: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o-mini',
  llmKey: '',
};

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function sanitizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  if (!hasLanguage(settings.lang)) settings.lang = DEFAULT_LANG;
  settings.engineMs = Math.round(clamp(settings.engineMs, 400, 2000, 600));
  settings.skillLevel = Math.round(clamp(settings.skillLevel, 0, 20, 20));
  settings.motionSensitivity = clamp(settings.motionSensitivity, 0.3, 3, 1);
  settings.settleMs = Math.round(clamp(settings.settleMs, 200, 1500, 400));
  settings.flip = Boolean(settings.flip);
  settings.detectionPaused = false;
  settings.promotionChoice = ['q', 'r', 'b', 'n'].includes(settings.promotionChoice)
    ? settings.promotionChoice
    : 'q';
  settings.eventName = typeof settings.eventName === 'string' && settings.eventName.trim()
    ? settings.eventName.trim()
    : 'Live Chess Show';
  settings.whitePlayer = typeof settings.whitePlayer === 'string' && settings.whitePlayer.trim()
    ? settings.whitePlayer.trim()
    : 'Grandmaster White';
  settings.blackPlayer = typeof settings.blackPlayer === 'string' && settings.blackPlayer.trim()
    ? settings.blackPlayer.trim()
    : 'Grandmaster Black';
  settings.showIntroScreen = Boolean(settings.showIntroScreen);
  settings.cameraBgMode = ['background', 'corner', 'off'].includes(settings.cameraBgMode)
    ? settings.cameraBgMode
    : 'background';
  settings.cameraBgOpacity = Math.round(clamp(settings.cameraBgOpacity, 0, 100, 35));
  settings.cameraBgBlur = Math.round(clamp(settings.cameraBgBlur, 0, 20, 6));
  settings.cameraBgBrightness = Math.round(clamp(settings.cameraBgBrightness, 50, 150, 100));
  settings.cameraBgMirror = Boolean(settings.cameraBgMirror);
  settings.cameraBgRotate = [0, 90, 180, 270].includes(Number(settings.cameraBgRotate))
    ? Number(settings.cameraBgRotate)
    : 0;
  settings.cameraBgPerfMode = Boolean(settings.cameraBgPerfMode);

  settings.cameraPanelShow = Boolean(settings.cameraPanelShow ?? DEFAULT_SETTINGS.cameraPanelShow);
  settings.cameraPanelSource = ['raw', 'warped'].includes(settings.cameraPanelSource)
    ? settings.cameraPanelSource
    : 'raw';
  settings.cameraPanelMirror = Boolean(settings.cameraPanelMirror);
  settings.cameraPanelRotate = [0, 90, 180, 270].includes(Number(settings.cameraPanelRotate))
    ? Number(settings.cameraPanelRotate)
    : 0;
  settings.cameraPanelSize = ['small', 'medium', 'large'].includes(settings.cameraPanelSize)
    ? settings.cameraPanelSize
    : 'medium';

  settings.recordingBitrate = Math.round(clamp(settings.recordingBitrate, 1, 10, 4));
  settings.recordingSegmentMinutes = Math.round(clamp(settings.recordingSegmentMinutes, 1, 60, 10));
  settings.recordingSource = ['camera', 'screen'].includes(settings.recordingSource)
    ? settings.recordingSource
    : 'camera';
  settings.deviceId = typeof settings.deviceId === 'string' ? settings.deviceId : '';
  settings.llmEnabled = Boolean(settings.llmEnabled);
  settings.llmBaseUrl = typeof settings.llmBaseUrl === 'string' && settings.llmBaseUrl
    ? settings.llmBaseUrl
    : DEFAULT_SETTINGS.llmBaseUrl;
  settings.llmModel = typeof settings.llmModel === 'string' && settings.llmModel
    ? settings.llmModel
    : DEFAULT_SETTINGS.llmModel;
  // API keys are intentionally never read from storage.
  settings.llmKey = '';
  return settings;
}

export function persistableSettings(settings) {
  const {
    llmKey,
    detectionPaused,
    ...safe
  } = settings;
  return safe;
}

function initialEvalEntry() {
  return {
    fen: START_FEN,
    eval: evalFromMaterial(START_FEN),
    bestMove: null,
    depth: 0,
    source: 'material',
  };
}

function terminalEvalFromResult(result) {
  if (!result?.over) return null;
  if (result.type === 'checkmate') {
    return {
      cpWhite: result.winner === 'w' ? MATE_CP : -MATE_CP,
      mateWhite: result.winner === 'w' ? 1 : -1,
      terminal: 'checkmate',
      winner: result.winner,
      source: 'engine',
    };
  }
  return {
    cpWhite: 0,
    mateWhite: null,
    terminal: result.type,
    winner: null,
    source: 'engine',
  };
}

function finalizeRecord(record, afterEval, preBestMove) {
  if (!record || !afterEval) return record;
  const classification = classifyMove({
    before: record.evalBefore,
    after: afterEval,
    move: record,
    preBestMove,
    forced: record.forced,
  });
  record.evalAfter = afterEval;
  record.winProbAfter = evalToWinProb(afterEval);
  record.verdict = classification.verdict;
  record.cpLoss = classification.cpLoss;
  record.sacrifice = classification.sacrifice;
  return record;
}

function buildRecord({
  move,
  fenBefore,
  fenAfter,
  ply,
  evalBefore,
  bestMoveBefore,
  source,
  gameOver,
  forced,
}) {
  return {
    id: `${Date.now()}-${ply}-${move.san}`,
    ply,
    color: move.color,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion || ''}`,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured || null,
    promotion: move.promotion || null,
    flags: move.flags,
    fenBefore,
    fenAfter,
    evalBefore: evalBefore || null,
    bestMoveBefore: bestMoveBefore || null,
    evalAfter: null,
    bestMoveAfter: null,
    verdict: null,
    cpLoss: null,
    sacrifice: false,
    forced: Boolean(forced),
    winProbBefore: evalBefore ? evalToWinProb(evalBefore) : null,
    winProbAfter: null,
    source,
    gameOver: gameOver?.over ? gameOver : { over: false },
    createdAt: Date.now(),
  };
}

let toastCounter = 0;

const savedSettings = sanitizeSettings(loadSettings());
const savedCalibration = loadCalibration();

export const useChessLens = create((set, get) => ({
  settings: savedSettings,
  calibration: savedCalibration,
  llmKey: '',
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,

  ui: {
    operatorOpen: false,
    calibrating: false,
    fullscreen: false,
    splash: true,
    toast: null,
  },

  engine: { status: 'loading', message: '' },
  camera: {
    status: 'idle',
    message: '',
    devices: [],
    deviceId: savedSettings.deviceId,
  },
  vision: {
    mode: 'idle',
    motion: 0,
    occluded: false,
    occlusionReason: null,
    driftDetected: false,
    testMode: false,
    testResult: null,
    changedCells: [],
    candidates: [],
    pending: false,
  },
  debug: {
    motion: 0,
    cellDiffs: [],
    changedCells: [],
    candidates: [],
    lastAnalysisAt: 0,
  },

  game: {
    fen: START_FEN,
    ply: 0,
    epoch: 0,
    moves: [],
    evalHistory: [initialEvalEntry()],
    lastMove: null,
    status: { over: false, type: null, winner: null },
    resultDismissed: false,
    bestMove: null,
    thinking: true,
  },

  verdict: null,
  commentary: {
    text: makeGameStartCommentary(savedSettings.lang),
    moveId: null,
    pending: false,
    llm: false,
  },

  demo: {
    active: false,
    mode: 'vs-computer',
    playerColor: 'w',
    index: 0,
    finished: false,
  },
  recording: {
    active: false,
    source: 'camera',
    startedAt: 0,
    elapsedSeconds: 0,
    segmentIndex: 1,
    savedSegments: 0,
    directoryChosen: false,
    lastError: null,
  },

  // ---------------------------------------------------------------- settings
  setSettings(patch) {
    const state = get();
    const nextPatch = { ...patch };
    if (nextPatch.lang && nextPatch.lang !== state.settings.lang) {
      const lang = nextPatch.lang;
      delete nextPatch.lang;
      get().setLanguage(lang);
    }
    if (Object.keys(nextPatch).length) {
      set((current) => ({
        settings: { ...current.settings, ...nextPatch },
      }));
    }
  },

  setLanguage(lang) {
    if (!hasLanguage(lang)) return;
    const state = get();
    if (state.settings.lang === lang) return;
    const lastRecord = state.game.moves[state.game.moves.length - 1];
    const previousMoves = state.game.moves.slice(0, -1);
    const text = lastRecord
      ? makeCommentary(lastRecord, lang, previousMoves)
      : makeGameStartCommentary(lang);
    if (lastRecord) lastRecord.commentaryText = text;
    set({
      settings: { ...state.settings, lang },
      commentary: {
        text,
        moveId: lastRecord?.id || null,
        pending: false,
        llm: false,
      },
    });
  },

  setLlmKey(llmKey) {
    set({ llmKey: String(llmKey || '') });
  },

  setOnline(online) {
    set({ online: Boolean(online) });
  },

  // -------------------------------------------------------------------- game
  commitMove({ move, fenAfter, source = 'operator', gameOver, forced = false }) {
    const state = get();
    if (!move || !fenAfter) return null;
    if (state.game.status.over) return null;

    const fenBefore = state.game.fen;
    const ply = state.game.ply;
    const currentEntry = state.game.evalHistory[ply] || null;
    const evalBefore = currentEntry?.eval || evalFromMaterial(fenBefore);
    const bestMoveBefore = currentEntry?.bestMove || null;

    const record = buildRecord({
      move,
      fenBefore,
      fenAfter,
      ply,
      evalBefore,
      bestMoveBefore,
      source,
      gameOver,
      forced,
    });

    const afterEval = terminalEvalFromResult(gameOver);
    const evalEntry = {
      fen: fenAfter,
      eval: afterEval,
      bestMove: null,
      depth: 0,
      source: afterEval ? 'engine' : null,
    };

    if (afterEval) {
      finalizeRecord(record, afterEval, bestMoveBefore);
      record.bestMoveAfter = null;
    }

    const moves = [...state.game.moves, record];
    const evalHistory = [...state.game.evalHistory, evalEntry];
    const status = gameOver?.over ? gameOver : { over: false, type: null, winner: null };
    const commentary = makeCommentary(record, state.settings.lang, state.game.moves);
    record.commentaryText = commentary;

    set({
      settings: state.settings.showIntroScreen
        ? { ...state.settings, showIntroScreen: false }
        : state.settings,
      game: {
        ...state.game,
        fen: fenAfter,
        ply: ply + 1,
        moves,
        evalHistory,
        lastMove: { from: move.from, to: move.to, color: move.color, san: move.san },
        status,
        resultDismissed: false,
        bestMove: null,
        thinking: !status.over,
      },
      verdict: afterEval
        ? { type: record.verdict, cpLoss: record.cpLoss, sacrifice: record.sacrifice, moveId: record.id }
        : null,
      commentary: {
        text: commentary,
        moveId: record.id,
        pending: !afterEval,
        llm: false,
      },
    });

    return record;
  },

  completeEval({ ply, fen, evalWhite, bestMove = null, depth = 0, source = 'engine', epoch }) {
    const state = get();
    if (!evalWhite) return null;
    if (typeof epoch === 'number' && epoch !== state.game.epoch) return null;
    if (!Number.isInteger(ply) || ply < 0 || ply >= state.game.evalHistory.length) return null;

    const entry = state.game.evalHistory[ply];
    if (!entry || entry.fen !== fen) return null;
    if (entry.eval && entry.source === 'engine' && source === 'engine') {
      // Keep the first full-strength result; it is already the best one.
      return null;
    }

    const evalHistory = [...state.game.evalHistory];
    evalHistory[ply] = {
      fen,
      eval: evalWhite,
      bestMove,
      depth,
      source,
      at: Date.now(),
    };

    const isCurrent = ply === state.game.ply;
    let moves = state.game.moves;
    let record = null;

    if (ply > 0) {
      const index = ply - 1;
      const previous = state.game.moves[index];
      if (previous && previous.fenAfter === fen) {
        const previousEval = previous.evalBefore
          || evalHistory[ply - 1]?.eval
          || evalFromMaterial(previous.fenBefore);
        const preBestMove = previous.bestMoveBefore || evalHistory[ply - 1]?.bestMove || null;
        const updated = { ...previous, evalBefore: previousEval };
        finalizeRecord(updated, evalWhite, preBestMove);
        updated.bestMoveAfter = bestMove;
        moves = [...state.game.moves];
        moves[index] = updated;
        record = updated;
      }
    }

    // If subsequent moves were already committed, backfill their evalBefore
    if (ply < state.game.moves.length) {
      const nextMove = state.game.moves[ply];
      if (nextMove && nextMove.fenBefore === fen) {
        if (moves === state.game.moves) moves = [...state.game.moves];
        const updatedNext = {
          ...nextMove,
          evalBefore: evalWhite,
          bestMoveBefore: bestMove,
        };
        if (updatedNext.evalAfter) {
          finalizeRecord(updatedNext, updatedNext.evalAfter, bestMove);
        }
        moves[ply] = updatedNext;
      }
    }

    const nextGame = {
      ...state.game,
      evalHistory,
      moves,
      bestMove: isCurrent ? bestMove : state.game.bestMove,
      thinking: isCurrent ? false : state.game.thinking,
    };

    const update = { game: nextGame };

    if (isCurrent) {
      if (record) {
        update.verdict = {
          type: record.verdict,
          cpLoss: record.cpLoss,
          sacrifice: record.sacrifice,
          moveId: record.id,
        };
        const previousMoves = moves.slice(0, ply - 1);
        const commentaryText = makeCommentary(record, state.settings.lang, previousMoves);
        record.commentaryText = commentaryText;
        update.commentary = {
          text: commentaryText,
          moveId: record.id,
          pending: false,
          llm: false,
        };
      } else {
        // Initial position evaluation.
        update.commentary = state.commentary;
      }
    }

    set(update);
    return record;
  },

  newGame() {
    const state = get();
    const lang = state.settings.lang;
    set({
      game: {
        fen: START_FEN,
        ply: 0,
        epoch: state.game.epoch + 1,
        moves: [],
        evalHistory: [initialEvalEntry()],
        lastMove: null,
        status: { over: false, type: null, winner: null },
        resultDismissed: false,
        bestMove: null,
        thinking: true,
      },
      verdict: null,
      commentary: {
        text: makeGameStartCommentary(lang),
        moveId: null,
        pending: false,
        llm: false,
      },
      vision: {
        ...state.vision,
        changedCells: [],
        candidates: [],
        pending: false,
      },
    });
  },

  undo() {
    const state = get();
    if (state.game.ply === 0) return false;
    const record = state.game.moves[state.game.ply - 1];
    const newPly = state.game.ply - 1;
    const moves = state.game.moves.slice(0, -1);
    const evalHistory = state.game.evalHistory.slice(0, state.game.ply);
    const fen = record.fenBefore;
    const status = gameResult(new Chess(fen));
    const previous = moves[moves.length - 1] || null;
    const lang = state.settings.lang;
    const currentEntry = evalHistory[newPly] || null;

    set({
      game: {
        ...state.game,
        fen,
        ply: newPly,
        epoch: state.game.epoch + 1,
        moves,
        evalHistory,
        lastMove: previous
          ? { from: previous.from, to: previous.to, color: previous.color, san: previous.san }
          : null,
        status: status.over ? status : { over: false, type: null, winner: null },
        bestMove: currentEntry?.bestMove || null,
        thinking: !currentEntry?.eval,
      },
      verdict: previous
        ? {
            type: previous.verdict,
            cpLoss: previous.cpLoss,
            sacrifice: previous.sacrifice,
            moveId: previous.id,
          }
        : null,
      commentary: {
        text: previous ? makeCommentary(previous, lang) : makeGameStartCommentary(lang),
        moveId: previous?.id || null,
        pending: false,
        llm: false,
      },
      vision: {
        ...state.vision,
        changedCells: [],
        candidates: [],
        pending: false,
      },
    });
    return true;
  },

  dismissResult() {
    set((state) => ({ game: { ...state.game, resultDismissed: true } }));
  },

  showResult() {
    set((state) => ({ game: { ...state.game, resultDismissed: false } }));
  },

  setShowIntroScreen(show) {
    set((state) => ({
      settings: { ...state.settings, showIntroScreen: Boolean(show) },
    }));
  },

  // --------------------------------------------------------------- infra/ui
  setEngine(patch) {
    set((state) => ({ engine: { ...state.engine, ...patch } }));
  },

  setCamera(patch) {
    set((state) => ({ camera: { ...state.camera, ...patch } }));
  },

  setVision(patch) {
    set((state) => ({ vision: { ...state.vision, ...patch } }));
  },

  setRecording(patch) {
    set((state) => ({ recording: { ...state.recording, ...patch } }));
  },

  setDebug(patch) {
    set((state) => ({ debug: { ...state.debug, ...patch } }));
  },

  setPendingDetection({ changedCells, candidates }) {
    set((state) => ({
      vision: {
        ...state.vision,
        mode: 'pending',
        pending: true,
        changedCells: [...changedCells],
        candidates,
      },
      debug: {
        ...state.debug,
        changedCells: [...changedCells],
        candidates,
        lastAnalysisAt: Date.now(),
      },
    }));
  },

  clearDetection() {
    set((state) => ({
      vision: {
        ...state.vision,
        mode: state.settings.detectionPaused ? 'paused' : 'watching',
        pending: false,
        candidates: [],
        changedCells: [],
      },
    }));
  },

  setCalibration(calibration) {
    set({ calibration });
  },

  clearCalibrationState() {
    set({ calibration: null });
  },

  setUi(patch) {
    set((state) => ({ ui: { ...state.ui, ...patch } }));
  },

  notify(message, kind = 'info') {
    toastCounter += 1;
    set((state) => ({
      ui: {
        ...state.ui,
        toast: { id: toastCounter, message, kind },
      },
    }));
  },

  clearToast(id) {
    set((state) => {
      if (id != null && state.ui.toast?.id !== id) return state;
      return { ui: { ...state.ui, toast: null } };
    });
  },

  setDemo(patch) {
    set((state) => ({ demo: { ...state.demo, ...patch } }));
  },

  setLlmPending(moveId, lang) {
    const state = get();
    if (state.commentary.moveId !== moveId || state.settings.lang !== lang) return;
    set({ commentary: { ...state.commentary, llmPending: true } });
  },

  applyLlmCommentary({ moveId, lang, text }) {
    const state = get();
    if (!text || typeof text !== 'string' || !text.trim()) return;
    const clean = text.trim();
    if (clean.length < 5 || /^error\b/i.test(clean) || /^i cannot\b/i.test(clean) || /^sorry\b/i.test(clean)) return;
    if (state.commentary.moveId !== moveId || state.settings.lang !== lang) return;
    set({
      commentary: {
        ...state.commentary,
        text: clean,
        pending: false,
        llm: true,
        llmPending: false,
      },
    });
  },
}));

export function availableLanguages() {
  return LANGUAGES;
}

export function currentEval(state) {
  const history = state.game.evalHistory;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.eval) return history[i].eval;
  }
  return null;
}
