import { AnimatePresence, motion } from 'framer-motion';
import { useChessLens } from '../state/store.js';
import { languageDir, translate } from '../i18n/translations.js';
import { cx } from './Ui.jsx';

export default function CommentaryCard() {
  const commentary = useChessLens((state) => state.commentary);
  const lang = useChessLens((state) => state.settings.lang);
  const t = (key) => translate(lang, key);
  const dir = languageDir(lang);

  return (
    <div className="panel relative overflow-hidden p-5">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-brass-400/80 via-brass-400/30 to-transparent" />
      <div className="pointer-events-none absolute -bottom-6 right-4 select-none font-serif text-[7rem] leading-none text-white/[0.035]">
        ”
      </div>

      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">{t('commentary')}</span>
          {commentary.llm && (
            <span className="rounded-full border border-brass-400/30 bg-brass-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-brass-200">
              {t('aiBadge')}
            </span>
          )}
          {commentary.pending && (
            <span className="text-[10px] font-medium uppercase tracking-widest text-white/30">
              {t('thinking')}
            </span>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.p
            key={commentary.text}
            dir={dir}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24 }}
            className={cx(
              'mt-2 line-clamp-4 text-balance leading-relaxed text-white/85',
              'text-[clamp(1.05rem,2.05vh,1.5rem)]',
              lang === 'ar' ? 'font-arabic leading-loose' : 'font-medium',
            )}
          >
            {commentary.text}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
