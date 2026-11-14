import { monthStart } from './finance';

const amountFormat = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "S$1,234.56"; negatives as "−S$12.00". */
export function money(value: number, currency: string): string {
  const v = Math.abs(value) < 0.005 ? 0 : value;
  return (v < 0 ? '−' : '') + currency + amountFormat.format(Math.abs(v));
}

export const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** "0 | Food & Drinks" → "Food & Drinks". The numeric prefix only sets the order. */
export const displayName = (name: string) => name.replace(/^\s*\d+\s*\|\s*/, '') || name;

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dayYearFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Local calendar day as a sortable number (ms at local midnight). */
export const dayOf = (iso: string | number | Date) => startOfDay(new Date(iso));

export function dayLabel(day: number, now = new Date()): string {
  const diff = Math.round((startOfDay(now) - day) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = new Date(day);
  return d.getFullYear() === now.getFullYear() ? dayFormat.format(d) : dayYearFormat.format(d);
}

export const timeLabel = (iso: string) => timeFormat.format(new Date(iso));
export const monthLabel = (m: number) => monthFormat.format(monthStart(m));
export const dateLabel = (isoDay: string) => dayYearFormat.format(new Date(`${isoDay}T12:00:00`));

const pad = (n: number) => String(n).padStart(2, '0');

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
