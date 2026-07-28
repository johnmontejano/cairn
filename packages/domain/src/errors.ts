/** Errors that map onto user-visible outcomes. Anything else is a bug and is logged. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    /** Ordinary-language sentence safe to show a person. */
    readonly userMessage: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends DomainError {
  constructor(detail = 'Not signed in') {
    super(detail, 'unauthorized', 401, 'Please sign in to continue.');
  }
}

export class ForbiddenError extends DomainError {
  constructor(detail = 'Not permitted') {
    super(detail, 'forbidden', 403, 'You do not have access to that.');
  }
}

export class NotFoundError extends DomainError {
  constructor(what = 'item') {
    super(`${what} not found`, 'not_found', 404, 'We could not find that.');
  }
}

export class ValidationError extends DomainError {
  constructor(
    detail: string,
    userMessage = 'Something in that request was not valid.',
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(detail, 'validation_failed', 400, userMessage);
  }
}

export class EvidenceRequiredError extends DomainError {
  constructor() {
    super(
      'A memory item cannot be approved without at least one evidence record',
      'evidence_required',
      422,
      'This cannot be saved because it has no source to point back to.',
    );
  }
}

export class ConflictError extends DomainError {
  constructor(detail: string, userMessage = 'This conflicts with something already saved.') {
    super(detail, 'conflict', 409, userMessage);
  }
}

export class SetupRequiredError extends DomainError {
  constructor(
    readonly provider: string,
    readonly missing: string[],
  ) {
    super(
      `${provider} is not configured (missing: ${missing.join(', ')})`,
      'setup_required',
      503,
      'That connection is not set up yet.',
    );
  }
}

export class BudgetExceededError extends DomainError {
  constructor(detail: string) {
    super(
      detail,
      'budget_exceeded',
      429,
      'This workspace has reached its monthly AI budget. Raise the limit in Settings to continue.',
    );
  }
}

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      'Rate limit exceeded',
      'rate_limited',
      429,
      'Too many requests. Please try again shortly.',
    );
  }
}

export class IntegrityError extends DomainError {
  constructor(detail: string) {
    super(
      detail,
      'integrity_failed',
      422,
      'This data did not pass its integrity check and was not used.',
    );
  }
}
