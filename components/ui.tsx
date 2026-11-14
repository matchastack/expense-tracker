'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { money } from '@/lib/format';
import { closeSheet } from '@/lib/nav';

/* ---------- Icons ---------- */

const PATHS: Record<string, string> = {
  home: 'M4 11.5 12 4l8 7.5M6.5 10v9.5h11V10',
  up: 'M7 17 17 7M9 7h8v8',
  down: 'M17 7 7 17M15 17H7V9',
  wallet: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5ZM16 13.5h.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  alert: 'M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01',
  offline: 'M3 3l18 18M8.5 8.6A5 5 0 0 0 7 18h10.5M10.6 5.2A5.5 5.5 0 0 1 17.5 10a4 4 0 0 1 3.2 6.3',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7',
  swap: 'M7 8h12l-3-3M17 16H5l3 3',
  card: 'M3.5 6.5h17v11h-17zM3.5 10h17M7 14.5h3',
  undo: 'M9 14 4.5 9.5 9 5M5 9.5h9a5.5 5.5 0 0 1 0 11h-3',
  repeat: 'M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 12l1.8-1.4-1.8-3.2-2.2.8a6 6 0 0 0-1.6-.9L14.8 5h-3.6l-.4 2.3a6 6 0 0 0-1.6.9L7 7.4 5.2 10.6 7 12l-1.8 1.4L7 16.6l2.2-.8c.5.4 1 .7 1.6.9l.4 2.3h3.6l.4-2.3c.6-.2 1.1-.5 1.6-.9l2.2.8 1.8-3.2L19 12Z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 16.5h.01',
  cloud: 'M7 18a5 5 0 1 1 1.2-9.9A5.5 5.5 0 0 1 18.5 10a4 4 0 0 1-.5 8H7Z',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  out: 'M10 5H5v14h5M14 8l4 4-4 4M18 12H9',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/* ---------- Bits ---------- */

export function Money({
  value,
  currency,
  tone,
  plus,
}: {
  value: number;
  currency: string;
  tone?: 'pos' | 'neg' | 'muted' | 'auto';
  plus?: boolean;
}) {
  const cls = tone === 'auto' ? (value < -0.004 ? 'neg' : '') : (tone ?? '');
  return <span className={`num ${cls}`}>{(plus && value > 0 ? '+' : '') + money(value, currency)}</span>;
}

export function Bar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'spend' }) {
  // With no limit set, any spending counts as over.
  const ratio = max > 0 ? value / max : value > 0 ? Infinity : 0;
  const over = tone === 'spend' && ratio > 1;
  const near = tone === 'spend' && ratio > 0.85 && !over;
  return (
    <div className={`bar ${over ? 'over' : near ? 'near' : ''}`} role="presentation">
      <div style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; badge?: number; alert?: boolean }>;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.badge ? <span className={`badge ${o.alert ? 'alert' : ''}`}>{o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------- Form controls ---------- */

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  const { label, hint, ...rest } = props;
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" autoComplete="off" {...rest} />
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  allowNone,
}: {
  options: Array<{ value: T; label: string; sub?: string }>;
  value: T | null;
  onChange: (v: T | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="chips">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            className={`chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on && allowNone ? null : o.value)}
          >
            {o.label}
            {o.sub ? <small>{o.sub}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch-row">
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/* ---------- Sheet ---------- */

export function Sheet({
  title,
  children,
  footer,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && closeSheet()}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={closeSheet}>
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-foot">{footer}</footer> : null}
      </form>
    </div>
  );
}

export function confirmDelete(what: string): boolean {
  return window.confirm(`Delete ${what}? This cannot be undone.`);
}
