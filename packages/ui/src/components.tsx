import clsx from 'clsx';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/**
 * The component set.
 *
 * Built on real HTML elements — `button`, `dialog`, `fieldset`, `output` — rather
 * than divs with roles, because the built-in semantics and keyboard behaviour are
 * the accessible behaviour. Every interactive control is at least 44px tall, and
 * every input is associated with a real label.
 */

/* --------------------------------- text --------------------------------- */

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="cairn-visually-hidden">{children}</span>;
}

export function SkipLink({ href = '#main' }: { href?: string }) {
  return (
    <a href={href} className="cairn-skip-link">
      Skip to the main content
    </a>
  );
}

/* -------------------------------- button -------------------------------- */

export type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: 'md' | 'lg';
  /** Replaces the label while a form is submitting; announced politely. */
  busy?: boolean;
  busyLabel?: string;
}

export function Button({
  tone = 'secondary',
  size = 'md',
  busy = false,
  busyLabel = 'Working…',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx('cairn-button', `cairn-button--${tone}`, `cairn-button--${size}`, className)}
    >
      {busy ? busyLabel : children}
    </button>
  );
}

export function LinkButton({
  tone = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: ButtonTone; size?: 'md' | 'lg' }) {
  return (
    <a
      {...rest}
      className={clsx('cairn-button', `cairn-button--${tone}`, `cairn-button--${size}`, className)}
    >
      {children}
    </a>
  );
}

/* --------------------------------- cards -------------------------------- */

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx('cairn-card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="cairn-card__header">
      <div>
        <h2 className="cairn-card__title">{title}</h2>
        {description ? <p className="cairn-card__description">{description}</p> : null}
      </div>
      {actions ? <div className="cairn-card__actions">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------- badges -------------------------------- */

export type BadgeTone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'accent';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={clsx('cairn-badge', `cairn-badge--${tone}`)}>{children}</span>;
}

/* -------------------------------- fields -------------------------------- */

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * The one place a label, hint, and error are wired to an input.
 *
 * `aria-describedby` and `aria-invalid` are derived here rather than at each call
 * site, so an error message is never shown without also being announced.
 */
export function Field({ id, label, hint, error, required, children }: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={clsx('cairn-field', error && 'cairn-field--invalid')}>
      <label className="cairn-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="cairn-field__required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <VisuallyHidden>(required)</VisuallyHidden> : null}
      </label>
      {hint ? (
        <p className="cairn-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        // `role="alert"` so the message is announced the moment it appears; a
        // field error nobody hears is not error identification.
        <p className="cairn-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  invalid,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={clsx('cairn-input', className)}
    />
  );
}

export function TextArea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={clsx('cairn-input', 'cairn-textarea', className)}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      className={clsx('cairn-input', 'cairn-select', className)}
    >
      {children}
    </select>
  );
}

/* ------------------------------- messages ------------------------------- */

export function Callout({
  tone = 'info',
  title,
  children,
  /** `assertive` only for errors the person must act on now. */
  live,
}: {
  tone?: 'info' | 'good' | 'warn' | 'danger';
  title?: ReactNode;
  children: ReactNode;
  live?: 'polite' | 'assertive';
}) {
  return (
    <div
      className={clsx('cairn-callout', `cairn-callout--${tone}`)}
      role={tone === 'danger' ? 'alert' : undefined}
      aria-live={live}
    >
      {title ? <p className="cairn-callout__title">{title}</p> : null}
      <div className="cairn-callout__body">{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="cairn-empty">
      <h3 className="cairn-empty__title">{title}</h3>
      {children ? <p className="cairn-empty__body">{children}</p> : null}
      {action ? <div className="cairn-empty__action">{action}</div> : null}
    </div>
  );
}

/* ------------------------------- progress ------------------------------- */

export interface ProgressStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

/**
 * The "Reading → Organizing → Ready" indicator.
 *
 * An ordered list with the current step named in text, not a bare animation, so
 * progress is understandable to a screen reader and to anyone who dislikes
 * spinners.
 */
export function ProgressSteps({
  steps,
  label = 'Progress',
}: {
  steps: ProgressStep[];
  label?: string;
}) {
  const active = steps.find((s) => s.state === 'active');
  return (
    <div className="cairn-progress">
      <ol className="cairn-progress__list" aria-label={label}>
        {steps.map((step) => (
          <li
            key={step.label}
            className={clsx('cairn-progress__step', `cairn-progress__step--${step.state}`)}
            aria-current={step.state === 'active' ? 'step' : undefined}
          >
            <span className="cairn-progress__dot" aria-hidden="true" />
            {step.label}
            {step.state === 'done' ? <VisuallyHidden>(done)</VisuallyHidden> : null}
          </li>
        ))}
      </ol>
      <output className="cairn-progress__status">{active ? `${active.label}…` : 'Ready'}</output>
    </div>
  );
}

/* -------------------------------- details ------------------------------- */

/**
 * The "Why do you know this?" affordance.
 *
 * A native `details`, so it works before hydration, is keyboard operable for
 * free, and cannot get stuck open in an inaccessible state.
 */
export function Disclosure({
  summary,
  children,
  tone = 'quiet',
}: {
  summary: ReactNode;
  children: ReactNode;
  tone?: 'quiet' | 'accent';
}) {
  return (
    <details className={clsx('cairn-disclosure', `cairn-disclosure--${tone}`)}>
      <summary className="cairn-disclosure__summary">{summary}</summary>
      <div className="cairn-disclosure__body">{children}</div>
    </details>
  );
}

/* ------------------------------ description ----------------------------- */

export function DescriptionList({
  items,
}: {
  items: Array<{ term: ReactNode; detail: ReactNode }>;
}) {
  return (
    <dl className="cairn-dl">
      {items.map((item, i) => (
        <div className="cairn-dl__row" key={i}>
          <dt className="cairn-dl__term">{item.term}</dt>
          <dd className="cairn-dl__detail">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stack({
  gap = 'md',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { gap?: 'sm' | 'md' | 'lg' }) {
  return (
    <div {...rest} className={clsx('cairn-stack', `cairn-stack--${gap}`, className)}>
      {children}
    </div>
  );
}
