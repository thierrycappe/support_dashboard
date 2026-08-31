export type IntakeErrorCode = 'IDEMPOTENCY_CONFLICT'

export class IntakeError extends Error {
  readonly code: IntakeErrorCode

  constructor(code: IntakeErrorCode) {
    super(code)
    this.name = 'IntakeError'
    this.code = code
  }
}
