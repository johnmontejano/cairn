'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Callout, Field, TextArea, TextInput } from '@cairn/ui';
import type { ActionResult } from '@/server/actions';

/**
 * Form plumbing.
 *
 * One wrapper owns the three things every form here needs: the CSRF token, a
 * pending state on the submit button, and a result message that is announced to
 * screen readers rather than only appearing visually.
 */

type ActionFn = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

export function SubmitButton({
  children,
  tone = 'primary',
  size = 'md',
  busyLabel,
}: {
  children: React.ReactNode;
  tone?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'md' | 'lg';
  busyLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      tone={tone}
      size={size}
      busy={pending}
      busyLabel={busyLabel ?? 'Working…'}
    >
      {children}
    </Button>
  );
}

export function ActionForm({
  action,
  csrf,
  children,
  hidden,
  className,
  onDone,
  successTone = 'good',
}: {
  action: ActionFn;
  csrf: string;
  children: React.ReactNode;
  hidden?: Record<string, string | undefined>;
  className?: string;
  onDone?: (result: ActionResult) => void;
  successTone?: 'good' | 'info';
}) {
  // The server action is passed straight through rather than wrapped in a client
  // function: that is what lets the form submit and report its result even before
  // the page has hydrated.
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {});

  useEffect(() => {
    // Reacting to the result is the point; `onDone` is a render-scoped callback
    // and is deliberately not a dependency.
    if (state.ok || state.error) onDone?.(state);
  }, [state]);

  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="csrf" value={csrf} />
      {Object.entries(hidden ?? {}).map(([name, value]) =>
        value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />,
      )}
      {children}
      {state.error ? (
        <div style={{ marginTop: '0.75rem' }}>
          <Callout tone="danger" live="assertive">
            {state.error}
          </Callout>
        </div>
      ) : null}
      {state.ok && state.message ? (
        <div style={{ marginTop: '0.75rem' }}>
          <Callout tone={successTone} live="polite">
            {state.message}
            {state.secret ? <CopyableCode value={state.secret} /> : null}
            {/* An action that cannot finish on its own says where to go next.
                Opened in a new tab so the person does not lose this page, and
                marked noopener because the destination is not ours. */}
            {state.handoffUrl ? (
              <div style={{ marginTop: '0.75rem' }}>
                <a
                  className="cairn-button cairn-button--primary"
                  href={state.handoffUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Continue to sign in
                </a>
              </div>
            ) : null}
          </Callout>
        </div>
      ) : null}
    </form>
  );
}

export function CopyableCode({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cairn-code-row">
      <code className="cairn-code">{value}</code>
      <Button
        type="button"
        tone="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : label}
      </Button>
      <span aria-live="polite" className="cairn-visually-hidden">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sign in
 * ------------------------------------------------------------------ */

export function SignInFlow({
  action,
  demoMode,
  next,
}: {
  action: ActionFn;
  demoMode: boolean;
  /** Where to land afterwards, when sign-in interrupted something else. */
  next?: string | null;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, { stage: 'email' });
  const emailId = useId();
  const codeId = useId();
  const onCodeStep = state.stage === 'code';

  return (
    <form action={formAction} className="cairn-stack cairn-stack--md">
      {/* Outside the step branches so it survives the email → code transition,
          which re-renders this form with different fields. */}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {onCodeStep ? (
        <>
          <input type="hidden" name="challengeId" value={state.id ?? ''} />
          <input type="hidden" name="devCode" value={state.secret ?? ''} />
          {state.message ? <Callout tone="info">{state.message}</Callout> : null}
          {demoMode && state.secret ? (
            <Callout tone="warn" title="This computer is running in demo mode">
              No email was actually sent. Your code is <strong>{state.secret}</strong>, and it was
              also printed in the terminal running the app.
            </Callout>
          ) : null}
          <Field id={codeId} label="Six-digit code" error={state.error ?? null} required>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>
          <div>
            <SubmitButton size="lg" busyLabel="Checking…">
              Sign in
            </SubmitButton>
          </div>
        </>
      ) : (
        <>
          <Field
            id={emailId}
            label="Your email address"
            hint="We send a short code. There is no password to remember."
            error={state.error ?? null}
            required
          >
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                name="email"
                type="email"
                autoComplete="email"
                required
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="you@example.com"
              />
            )}
          </Field>
          <div>
            <SubmitButton size="lg" busyLabel="Sending…">
              Continue
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Adding information
 * ------------------------------------------------------------------ */

export function PasteForm({
  action,
  csrf,
  projectId,
}: {
  action: ActionFn;
  csrf: string;
  projectId: string;
}) {
  const titleId = useId();
  const textId = useId();
  return (
    <ActionForm
      action={action}
      csrf={csrf}
      hidden={{ projectId }}
      className="cairn-stack cairn-stack--md"
    >
      <Field id={titleId} label="What is this?" hint="A few words, so you can recognise it later.">
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            name="title"
            aria-describedby={describedBy}
            placeholder="Notes from the planning meeting"
            maxLength={140}
          />
        )}
      </Field>
      <Field
        id={textId}
        label="What would you like remembered?"
        hint="Paste anything: notes, an email, a plan. It stays private to you."
        required
      >
        {({ id, describedBy }) => (
          <TextArea id={id} name="text" required aria-describedby={describedBy} rows={10} />
        )}
      </Field>
      <div>
        <SubmitButton busyLabel="Reading…">Add this</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function UploadForm({
  action,
  csrf,
  projectId,
  accept,
}: {
  action: ActionFn;
  csrf: string;
  projectId: string;
  accept: string;
}) {
  const fileId = useId();
  return (
    <ActionForm
      action={action}
      csrf={csrf}
      hidden={{ projectId }}
      className="cairn-stack cairn-stack--md"
    >
      <Field
        id={fileId}
        label="Choose files"
        hint={`Word documents, PDFs, and text files work. Up to 10 at a time.`}
        required
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            className="cairn-input"
            type="file"
            name="files"
            multiple
            required
            accept={accept}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <div>
        <SubmitButton busyLabel="Reading…">Add these</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function UrlForm({
  action,
  csrf,
  projectId,
}: {
  action: ActionFn;
  csrf: string;
  projectId: string;
}) {
  const urlId = useId();
  return (
    <ActionForm
      action={action}
      csrf={csrf}
      hidden={{ projectId }}
      className="cairn-stack cairn-stack--md"
    >
      <Field
        id={urlId}
        label="Web address"
        hint="We read the page once. Private or internal addresses are refused."
        required
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            name="url"
            type="url"
            required
            placeholder="https://example.com/page"
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <div>
        <SubmitButton busyLabel="Reading…">Read this page</SubmitButton>
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ *
 * Memory review
 * ------------------------------------------------------------------ */

export function MemoryReviewActions({
  csrf,
  projectId,
  memoryItemId,
  keepAction,
  removeAction,
  editAction,
  title,
  value,
  sensitivity,
  visibility,
  approved,
}: {
  csrf: string;
  projectId: string;
  memoryItemId: string;
  keepAction: ActionFn;
  removeAction: ActionFn;
  editAction: ActionFn;
  title: string;
  value: string;
  sensitivity: string;
  visibility: string;
  approved: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const titleId = useId();
  const valueId = useId();

  if (editing) {
    return (
      <ActionForm
        action={editAction}
        csrf={csrf}
        hidden={{ projectId, memoryItemId }}
        className="cairn-stack cairn-stack--sm"
        onDone={(result) => {
          if (result.ok) setEditing(false);
        }}
      >
        <Field id={titleId} label="Short name" required>
          {({ id }) => (
            <TextInput id={id} name="title" defaultValue={title} required maxLength={200} />
          )}
        </Field>
        <Field id={valueId} label="What to remember" required>
          {({ id }) => <TextArea id={id} name="value" defaultValue={value} required rows={4} />}
        </Field>
        <fieldset className="cairn-fieldset">
          <legend>Who can see this</legend>
          <label className="cairn-choice">
            <input
              type="radio"
              name="visibility"
              value="share_with_authorized_clients"
              defaultChecked={visibility === 'share_with_authorized_clients'}
            />
            You, and the AI tools you have connected
          </label>
          <label className="cairn-choice">
            <input
              type="radio"
              name="visibility"
              value="website_only"
              defaultChecked={visibility === 'website_only'}
            />
            Only you, on this website
          </label>
          <label className="cairn-choice">
            <input
              type="radio"
              name="visibility"
              value="never_share"
              defaultChecked={visibility === 'never_share'}
            />
            Only you, and never sent anywhere
          </label>
        </fieldset>
        <input type="hidden" name="sensitivity" value={sensitivity} />
        <div className="cairn-row">
          <SubmitButton busyLabel="Saving…">Save</SubmitButton>
          <Button type="button" tone="quiet" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </ActionForm>
    );
  }

  return (
    <div className="cairn-row">
      {approved ? null : (
        <ActionForm action={keepAction} csrf={csrf} hidden={{ projectId, memoryItemId }}>
          <SubmitButton busyLabel="Saving…">Keep</SubmitButton>
        </ActionForm>
      )}
      <Button type="button" tone="secondary" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <ActionForm action={removeAction} csrf={csrf} hidden={{ projectId, memoryItemId }}>
        <SubmitButton tone="quiet" busyLabel="Removing…">
          Remove
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

/** A confirm step for anything that cannot be undone from the interface. */
export function ConfirmForm({
  action,
  csrf,
  hidden,
  confirmLabel,
  children,
}: {
  action: ActionFn;
  csrf: string;
  hidden?: Record<string, string | undefined>;
  confirmLabel: string;
  children: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button type="button" tone="danger" onClick={() => setArmed(true)}>
        {confirmLabel}
      </Button>
    );
  }
  return (
    <ActionForm action={action} csrf={csrf} hidden={hidden} className="cairn-stack cairn-stack--sm">
      {children}
      <div className="cairn-row">
        <SubmitButton tone="danger" busyLabel="Working…">
          Yes, {confirmLabel.toLowerCase()}
        </SubmitButton>
        <Button type="button" tone="quiet" onClick={() => setArmed(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}
