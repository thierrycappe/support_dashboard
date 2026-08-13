# Privacy log hardening report

## Outcome

Daily-report and password-reset Resend failures now share one fixed structured
log contract. A rejected provider response records only
`PROVIDER_REJECTED`, its numeric HTTP status, and a bounded validated
`x-request-id`. A transport failure records only `TRANSPORT_FAILURE` with null
status and request ID. Provider bodies are cancelled without parsing; caught
values are ignored rather than serialized.

No failure log includes recipient email, reset URL/token, user ID, dashboard
content/counts, provider response text, raw exceptions, credentials, or
transport internals. Successful delivery behavior and the public result types
are unchanged.

## RED evidence

Command:

```text
npx vitest run tests/unit/daily-report-notifications.test.ts tests/unit/password-reset.test.ts
```

Result before production changes: 2 files failed, with 4 expected privacy
failures and 7 existing tests passing. Exact assertion diffs proved that:

- daily-report rejection logged the full provider body and open-ticket count;
- daily-report transport failure logged the raw `Error` and open-ticket count;
- password-reset rejection logged the full provider body and user ID; and
- password-reset transport failure logged the raw `Error` and user ID.

## GREEN evidence

Focused command:

```text
npx vitest run tests/unit/daily-report-notifications.test.ts tests/unit/password-reset.test.ts
npx eslint lib/email/resend.ts lib/notifications/daily-report.ts lib/auth/password-reset.ts tests/unit/daily-report-notifications.test.ts tests/unit/password-reset.test.ts
```

Result: 2 test files and all 11 tests passed; scoped ESLint exited 0.

The retained tests assert each complete structured log call and serialize the
captured calls to prove that seeded email addresses, reset paths, user IDs, API
keys, provider hostnames, and raw transport messages are absent.

Full relevant gate attempt:

```text
npm test -- --run
npm run typecheck
npm run lint
```

- Full ESLint passed.
- Full unit reached 50 passing files / 377 passing tests; its remaining 3
  files / 7 failures are concurrent, uncommitted admin-credential lifecycle
  work (`CredentialLifecycle`, admin rotation/revoke actions, and inventory),
  which this privacy change was explicitly scoped not to touch.
- Typecheck reports the same five missing concurrent credential-lifecycle
  exports/modules and no privacy-path diagnostic.
- Per coordination, the privacy commit proceeds on focused and lint evidence;
  the root owner will run the combined full gates after that admin slice lands.

## Files

- `lib/email/resend.ts` — shared sanitized failure envelope and response-body
  disposal.
- `lib/notifications/daily-report.ts` — fixed-envelope failure logging.
- `lib/auth/password-reset.ts` — fixed-envelope failure logging.
- `tests/unit/daily-report-notifications.test.ts` — response and transport
  privacy regressions.
- `tests/unit/password-reset.test.ts` — response and transport privacy
  regressions through the real reset request flow.
- `SECURITY.md` — closes the documented pre-cutover logging gap.

## Self-review

- The provider body is never read, parsed, or logged on failure.
- Catch clauses bind no error value, preventing accidental raw-error reuse.
- Request IDs accept only a bounded conservative character set; missing or
  malformed values become null.
- Logger metadata has no caller-specific context beyond fixed class/status/
  correlation fields.
- No credential lifecycle or Task 24 report file was changed.
