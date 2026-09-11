export type IntakeErrorCode = 'IDEMPOTENCY_CONFLICT' | 'APPLICATION_UNAVAILABLE'

export class IntakeError extends Error {
  readonly code: IntakeErrorCode

  constructor(code: IntakeErrorCode) {
    super(code)
    this.name = 'IntakeError'
    this.code = code
  }
}
