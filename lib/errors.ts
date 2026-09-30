/** Shared error classes used across API auth and tenant resolution. */

export class UnauthorizedError extends Error {
  constructor() { super("Unauthorized"); this.name = "UnauthorizedError"; }
}

export class NoCompanyError extends Error {
  constructor() { super("No company found for current user"); this.name = "NoCompanyError"; }
}

export class MissingCompanyHeaderError extends Error {
  constructor() { super("x-company-id header required for API key auth"); this.name = "MissingCompanyHeaderError"; }
}

export class AmbiguousCompanyContextError extends Error {
  constructor() {
    super("x-company-id header required when API key can access multiple companies");
    this.name = "AmbiguousCompanyContextError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") { super(message); this.name = "ForbiddenError"; }
}

export class InvalidCompanySelectorError extends ForbiddenError {
  readonly code = "invalid_active_company_selector";
  readonly selectorSource: "header" | "cookie";

  constructor(selectorSource: "header" | "cookie") {
    super("Requested active company is not accessible for the current user");
    this.name = "InvalidCompanySelectorError";
    this.selectorSource = selectorSource;
  }
}
