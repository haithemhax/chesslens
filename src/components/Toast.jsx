import { AnimatePresence, motion } from 'framer-motion';
import { useChessLens } from '../state/store.js';
import { cx } from './Ui.jsx';

const TONES = {
  success: 'border-emerald-400/30 bg-emerald-950/90 text-emerald-100',
  error: 'border-red-400/30 bg-red-950/90 text-red-100',
  warning: 'border-amber-400/30 bg-amber-950/90 text-amber-100',
  info: 'border-white/15 bg-ink-850/95 text-white/85',
};

const DOTS = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-brass-300',
};

export default function Toast() {
  const toast = useChessLens((state) => state.ui.toast);
  const clearToast = useChessLens((state) => state.clearToast);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4">
      <AnimatePresence>
        {toast && (
          <motion.button
            key={toast.id}
            type="button"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={() => clearToast(toast.id)}
            className={cx(
              'pointer-events-auto flex max-w-2xl items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm shadow-2xl backdrop-blur-md',
              TONES[toast.kind] || TONES.info,
            )}
          >
            <span className={cx('h-2 w-2 shrink-0 rounded-full', DOTS[toast.kind] || DOTS.info)} />
            <span className="leading-snug">{toast.message}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
