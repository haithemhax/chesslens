export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const VERDICT_TONE = {
  brilliant: 'text-brass-300',
  best: 'text-emerald-300',
  excellent: 'text-teal-300',
  good: 'text-sky-300',
  inaccuracy: 'text-amber-300',
  mistake: 'text-orange-300',
  blunder: 'text-red-300',
};

export const VERDICT_DOT = {
  brilliant: 'bg-brass-300',
  best: 'bg-emerald-300',
  excellent: 'bg-teal-300',
  good: 'bg-sky-300',
  inaccuracy: 'bg-amber-300',
  mistake: 'bg-orange-300',
  blunder: 'bg-red-300',
};

const PILL_TONES = {
  neutral: 'border-white/10 bg-white/[0.04] text-white/55',
  brass: 'border-brass-400/30 bg-brass-400/10 text-brass-200',
  good: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  bad: 'border-red-400/30 bg-red-400/10 text-red-200',
};

export function Pill({ tone = 'neutral', dot = false, className, children }) {
  return (
    <span className={cx('chip', PILL_TONES[tone] || PILL_TONES.neutral, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function Section({ title, children, className }) {
  return (
    <section className={cx('border-t border-white/[0.06] px-4 py-4', className)}>
      {title && <h3 className="eyebrow mb-3">{title}</h3>}
      {children}
    </section>
  );
}

export function Switch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-6 w-11 shrink-0 rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brass-400/60 disabled:opacity-40',
        checked
          ? 'border-brass-400/60 bg-brass-400/30'
          : 'border-white/15 bg-white/[0.06]',
      )}
    >
      <span
        className={cx(
          'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all',
          checked ? 'left-[23px]' : 'left-[3px]',
        )}
      />
    </button>
  );
}

export function RangeRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled = false,
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        <span className="value">{display ?? value}</span>
      </span>
      <input
        type="range"
        className="range mt-2"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
