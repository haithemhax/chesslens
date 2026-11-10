import { translate } from '../i18n/translations.js';
import { useChessLens } from '../state/store.js';
import { cx, Pill } from './Ui.jsx';

export default function CameraFitPanel({
  fitResult = null,
  compact = false,
  onCaptureBaseline = null,
  baselineActive = false,
  className = '',
}) {
  const lang = useChessLens((state) => state.settings.lang);
  const t = (key, vars) => translate(lang, key, vars);

  if (!fitResult) {
    return (
      <div className={cx('rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/40', className)}>
        {t('cameraFitChecking')}
      </div>
    );
  }

  const { status, score, geom, img, messages, driftDetected } = fitResult;

  const tone = status === 'good' ? 'good' : status === 'warning' ? 'warn' : 'bad';
  const statusLabel = status === 'good' ? t('cameraFitGood') : status === 'warning' ? t('cameraFitWarning') : t('cameraFitPoor');

  const pixelsPerSq = geom?.pixelsPerSquare ?? 0;
  const gridScore = img?.gridScore ?? null;
  const sharpness = img?.sharpness ?? null;
  const brightness = img?.meanBrightness ?? null;
  const glareCount = img?.glareSquares?.length ?? 0;

  return (
    <div className={cx('rounded-xl border border-white/10 bg-ink-900/80 p-3.5 backdrop-blur-md shadow-lg', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs tracking-wide uppercase text-white/80">{t('cameraFit')}</span>
          <Pill tone={tone} dot>
            {statusLabel}
          </Pill>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-white/60">{score}/100</span>
          {onCaptureBaseline && (
            <button
              type="button"
              onClick={onCaptureBaseline}
              className={cx(
                'btn px-2.5 py-1 text-[11px] font-medium transition',
                baselineActive ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' : 'border-white/15 hover:border-brass-400/50',
              )}
              title={t('captureBaselineHint')}
            >
              {baselineActive ? `✓ ${t('captureBaseline')}` : t('captureBaseline')}
            </button>
          )}
        </div>
      </div>

      {/* Actionable Messages List */}
      {messages.length > 0 ? (
        <div className="mt-2.5 space-y-1.5">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={cx(
                'flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug',
                status === 'poor'
                  ? 'border-red-500/25 bg-red-500/10 text-red-200'
                  : 'border-amber-400/25 bg-amber-400/10 text-amber-200',
              )}
            >
              <span className="shrink-0 mt-0.5 text-xs font-bold">
                {status === 'poor' ? '⚠️' : 'ℹ️'}
              </span>
              <span>{msg}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-emerald-300/80">
          ✓ Frame coverage, resolution, angle, and illumination are optimal.
        </p>
      )}

      {/* Metrics Row */}
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px]">
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-1.5">
          <div className="text-white/40">{t('pixelsPerSq')}</div>
          <div
            className={cx(
              'mt-0.5 font-mono font-bold text-xs',
              pixelsPerSq >= 60 ? 'text-emerald-400' : pixelsPerSq >= 35 ? 'text-amber-400' : 'text-red-400',
            )}
          >
            {pixelsPerSq > 0 ? `${pixelsPerSq}px` : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-1.5">
          <div className="text-white/40">{t('gridScore')}</div>
          <div
            className={cx(
              'mt-0.5 font-mono font-bold text-xs',
              gridScore != null && gridScore >= 55 ? 'text-emerald-400' : gridScore != null && gridScore >= 35 ? 'text-amber-400' : 'text-red-400',
            )}
          >
            {gridScore != null ? `${gridScore}` : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-1.5">
          <div className="text-white/40">{t('sharpness')}</div>
          <div
            className={cx(
              'mt-0.5 font-mono font-bold text-xs',
              img?.sharpnessDropPct && img.sharpnessDropPct >= 40 ? 'text-red-400' : 'text-white/80',
            )}
          >
            {sharpness != null ? `${Math.round(sharpness)}` : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-1.5">
          <div className="text-white/40">{t('brightness')}</div>
          <div
            className={cx(
              'mt-0.5 font-mono font-bold text-xs',
              brightness != null && (brightness < 60 || brightness > 200 || glareCount > 0) ? 'text-amber-400' : 'text-white/80',
            )}
          >
            {brightness != null ? `${brightness}` : '—'}
            {glareCount > 0 && <span className="text-red-400 ml-1">⚡{glareCount}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
