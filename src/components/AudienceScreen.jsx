import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useChessLens } from '../state/store.js';
import { languageLabel, translate } from '../i18n/translations.js';
import ChessBoard from './ChessBoard.jsx';
import CommentaryCard from './CommentaryCard.jsx';
import EvalBar from './EvalBar.jsx';
import EvalGraph from './EvalGraph.jsx';
import MoveList from './MoveList.jsx';
import VerdictBanner from './VerdictBanner.jsx';
import TitleIntroModal from './TitleIntroModal.jsx';
import FinalResultModal from './FinalResultModal.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import CameraBackground from './CameraBackground.jsx';
import CameraPanel from './CameraPanel.jsx';
import { cx } from './Ui.jsx';

export default function AudienceScreen() {
  const lang = useChessLens((state) => state.settings.lang);
  const eventName = useChessLens((state) => state.settings.eventName);
  const whitePlayer = useChessLens((state) => state.settings.whitePlayer);
  const blackPlayer = useChessLens((state) => state.settings.blackPlayer);
  const fen = useChessLens((state) => state.game.fen);
  const ply = useChessLens((state) => state.game.ply);
  const demo = useChessLens((state) => state.demo.active);
  const cameraStatus = useChessLens((state) => state.camera.status);
  const calibration = useChessLens((state) => state.calibration);
  const cameraPanelShow = useChessLens((state) => state.settings.cameraPanelShow ?? true);
  const cameraPanelSize = useChessLens((state) => state.settings.cameraPanelSize || 'medium');
  const t = (key, vars) => translate(lang, key, vars);

  const turn = useMemo(() => {
    try {
      return new Chess(fen).turn();
    } catch {
      return 'w';
    }
  }, [fen]);

  const moveNumber = Math.floor(ply / 2) + 1;
  const live = demo || cameraStatus === 'live';

  const [cursorHidden, setCursorHidden] = useState(false);
  const idleTimerRef = useRef(null);

  useEffect(() => {
    const handleMove = () => {
      setCursorHidden(false);
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setCursorHidden(true);
      }, 2500);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('pointerdown', handleMove);
    idleTimerRef.current = setTimeout(() => setCursorHidden(true), 2500);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('pointerdown', handleMove);
      clearTimeout(idleTimerRef.current);
    };
  }, []);

  return (
    <div
      className={cx(
        'relative flex min-h-screen flex-col overflow-hidden bg-ink-950 text-white lg:h-screen',
        cursorHidden && 'cursor-none',
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_18%_0%,rgba(212,168,79,0.10),transparent_55%),radial-gradient(ellipse_at_85%_100%,rgba(56,189,248,0.055),transparent_50%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />

      <ErrorBoundary name="CameraBackground">
        <CameraBackground />
      </ErrorBoundary>

      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-4 lg:px-10 lg:py-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-brass-400/30 bg-gradient-to-br from-brass-400/20 to-transparent shadow-glow">
            <span className="font-chess text-2xl leading-none text-brass-300">♞</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-xl font-semibold tracking-tight">
              {eventName ? (
                <span className="text-white">{eventName}</span>
              ) : (
                <>Chess<span className="text-brass-300">Lens</span></>
              )}
            </div>
            <div className="truncate text-[10px] uppercase tracking-[0.28em] text-white/40">
              {t('tagline')}
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <div className="chip border-white/10 hidden xl:inline-flex">
            <span className="font-semibold text-white/90">{whitePlayer}</span>
            <span className="text-brass-300 font-bold">vs</span>
            <span className="font-semibold text-white/90">{blackPlayer}</span>
          </div>
          <div className="chip border-white/10">
            <span
              className={cx(
                'h-2 w-2 rounded-full border',
                turn === 'w'
                  ? 'border-white/30 bg-white'
                  : 'border-white/20 bg-ink-950',
              )}
            />
            {turn === 'w' ? t('turnWhite') : t('turnBlack')}
          </div>
          <div className="chip border-white/10">
            {t('moveNumber')} <span className="font-mono text-white/75">{moveNumber}</span>
          </div>
          {!calibration && !demo && (
            <div className="chip border-amber-400/30 bg-amber-400/10 text-amber-200/90">
              {t('calibrationNeeded')}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {demo && (
            <span className="chip border-brass-400/40 bg-brass-400/10 text-brass-200">
              {t('demoBadge')}
            </span>
          )}
          <span
            className={cx(
              'chip',
              live
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                : 'border-white/10 text-white/45',
            )}
          >
            <span
              className={cx(
                'h-1.5 w-1.5 rounded-full',
                live ? 'animate-pulse bg-emerald-400' : 'bg-white/25',
              )}
            />
            {live ? t('live') : t('cameraOff')}
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.2em] text-white/30 sm:block">
            {languageLabel(lang)}
          </span>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1700px] flex-1 flex-col gap-5 px-5 pb-5 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-stretch lg:gap-8 lg:px-10 lg:pb-8">
        <section className="flex min-h-0 items-center justify-center gap-3 sm:gap-5">
          <ErrorBoundary name="EvalBar">
            <EvalBar />
          </ErrorBoundary>
          <ErrorBoundary name="ChessBoard">
            <ChessBoard />
          </ErrorBoundary>
        </section>

        <section className="flex min-h-0 flex-col gap-4 lg:gap-5">
          <div
            className={cx(
              'grid min-h-0 gap-4',
              cameraPanelShow
                ? cameraPanelSize === 'small'
                  ? 'grid-cols-1 xl:grid-cols-[0.85fr_1.15fr]'
                  : cameraPanelSize === 'large'
                    ? 'grid-cols-1 xl:grid-cols-[1.18fr_0.82fr]'
                    : 'grid-cols-1 xl:grid-cols-2'
                : 'grid-cols-1',
            )}
          >
            {cameraPanelShow && (
              <ErrorBoundary name="CameraPanel">
                <CameraPanel />
              </ErrorBoundary>
            )}
            <ErrorBoundary name="VerdictBanner">
              <VerdictBanner />
            </ErrorBoundary>
          </div>
          <ErrorBoundary name="CommentaryCard">
            <CommentaryCard />
          </ErrorBoundary>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[1.05fr_0.95fr]">
            <ErrorBoundary name="MoveList">
              <MoveList />
            </ErrorBoundary>
            <ErrorBoundary name="EvalGraph">
              <EvalGraph />
            </ErrorBoundary>
          </div>
        </section>
      </main>

      <TitleIntroModal />
      <FinalResultModal />
    </div>
  );
}
