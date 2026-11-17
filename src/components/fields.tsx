import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtAltShort, parseAlt } from '../lib/format';

interface TextishProps {
  label?: string;
  ariaLabel?: string;
  unit?: string;
  placeholder?: string;
  width?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Text box that keeps what you type until Enter or blur, then commits a parsed value. */
function CommitField({
  text,
  onCommit,
  label,
  ariaLabel,
  unit,
  placeholder,
  width,
  disabled,
  autoFocus,
  inputMode = 'decimal',
}: TextishProps & { text: string; onCommit: (raw: string) => boolean; inputMode?: 'decimal' | 'text' }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const commit = () => {
    if (draft == null) return;
    const ok = onCommit(draft);
    setBad(!ok);
    if (ok) setDraft(null);
  };

  const input = (
    <span className={`field${bad ? ' field-bad' : ''}${disabled ? ' field-off' : ''}`} style={width ? { width } : undefined}>
      <input
        ref={ref}
        value={draft ?? text}
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        aria-invalid={bad || undefined}
        disabled={disabled}
        inputMode={inputMode}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setDraft(e.target.value);
          setBad(false);
        }}
        onBlur={commit}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            setBad(false);
          }
        }}
      />
      {unit && <span className="field-unit">{unit}</span>}
    </span>
  );

  if (!label) return input;
  return (
    <label className="labelled">
      <span className="labelled-text">{label}</span>
      {input}
    </label>
  );
}

export function NumField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  decimals = 0,
  allowEmpty = false,
  ...rest
}: TextishProps & {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  decimals?: number;
  allowEmpty?: boolean;
}) {
  return (
    <CommitField
      {...rest}
      text={value == null ? '' : decimals ? String(Number(value.toFixed(decimals))) : String(Math.round(value))}
      onCommit={(raw) => {
        const t = raw.trim().replace(',', '.');
        if (!t) {
          if (allowEmpty) onChange(null);
          return allowEmpty;
        }
        let n = Number(t.replace(/^M?\./i, '0.'));
        if (!Number.isFinite(n)) return false;
        if (n < min || n > max) return false;
        const f = Math.pow(10, decimals);
        n = Math.round(n * f) / f;
        onChange(n);
        return true;
      }}
    />
  );
}

export function AltField({
  value,
  onChange,
  transLevel,
  allowEmpty = false,
  ...rest
}: TextishProps & {
  value: number | null;
  onChange: (v: number | null) => void;
  transLevel: number;
  allowEmpty?: boolean;
}) {
  return (
    <CommitField
      {...rest}
      inputMode="text"
      text={value == null ? '' : fmtAltShort(value, transLevel)}
      onCommit={(raw) => {
        if (!raw.trim()) {
          if (allowEmpty) onChange(null);
          return allowEmpty;
        }
        const v = parseAlt(raw);
        if (v == null) return false;
        onChange(v);
        return true;
      }}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
