import clsx from 'clsx';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Small presentational primitives. Deliberately plain: this is an internal
 * tool used all day, so density and legibility beat visual flourish.
 */

export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & ComponentProps<'section'>) {
  return (
    <section
      {...rest}
      className={clsx(
        'rounded-lg border bg-[var(--surface)] p-5 shadow-sm',
        'border-[var(--border)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary:
    'border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-muted)] disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'hover:bg-[var(--surface-muted)] disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  className,
  ...rest
}: { variant?: ButtonVariant } & ComponentProps<'button'>) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium',
        'transition-colors disabled:cursor-not-allowed',
        BUTTON_STYLES[variant],
        className,
      )}
    />
  );
}

export function LinkButton({
  variant = 'primary',
  className,
  ...rest
}: { variant?: ButtonVariant } & ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium',
        'transition-colors',
        BUTTON_STYLES[variant],
        className,
      )}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {/*
          Hidden from assistive tech: the control's own `required` attribute
          already announces the requirement, and letting the asterisk into the
          accessible name turns every label into "氏名*", which reads badly and
          makes labels ambiguous to match on.
        */}
        {required && (
          <span aria-hidden="true" className="ml-1 text-red-600">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ' +
  'placeholder:text-[var(--text-muted)] disabled:opacity-60';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={clsx(CONTROL, className)} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea {...rest} className={clsx(CONTROL, 'min-h-24', className)} />;
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select {...rest} className={clsx(CONTROL, className)} />;
}

export function Badge({
  children,
  colorHex,
  className,
}: {
  children: ReactNode;
  colorHex?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        !colorHex && 'bg-[var(--surface-muted)] text-[var(--text-muted)]',
        className,
      )}
      style={colorHex ? { backgroundColor: `${colorHex}1a`, color: colorHex } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * An empty state that says what to do next. A blank panel with no guidance is
 * the single most common way an internal tool wastes an operator's time.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--border)] px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-[var(--text-muted)]">{description}</p>}
      {action}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-200',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
    danger: 'border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
  };
  return (
    <div role="alert" className={clsx('rounded-md border px-4 py-3 text-sm', tones[tone])}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

/** Numeric display with its unit, so a figure is never ambiguous on screen. */
export function Stat({
  label,
  value,
  unit,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">{unit}</span>}
      </p>
      {hint && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}
