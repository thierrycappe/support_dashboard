# Application enrollment and lifecycle

Administrators can manage an application from the Applications list or its detail page.

- **Resubmit enrollment** is available for pending, unsuspended applications. It invalidates previous unused invitations and displays a fresh 30-minute invitation once. Store it in the connector configuration before leaving; existing identity, owners, and notification policy are retained.
- **Suspend application** blocks new incoming escalations and service authentication. Existing tickets and previously queued deliveries remain. **Resume application** restores access without changing the enrollment state. A pending app still needs to enroll.
- **Delete application** requires explicit confirmation. It permanently revokes credentials and unused invitations and removes the application from administration. Ticket and audit history remain available; its slug stays reserved so old connectors cannot recreate it.

A pull that encounters a suspended or deleted application stops with `APPLICATION_UNAVAILABLE`, without emitting a warning for every ticket.

## Agent onboarding

Local apps in the operator's Vercel team can use the shared `connect-control-tower` skill in `/Users/thierry/PycharmProjects/Claude-Skills/connect-control-tower`. It is available to Claude Code and Codex through their skill-directory symlinks. No MCP server is needed.

The trusted registrar calls `POST /api/v1/app-registrations` with Bearer authorization and a JSON body containing `name`, `slug`, `baseUrl`, `environment` (`production` or `preview`), `ownerIds`, an Ed25519 `publicKey`, `vercelProjectId`, and `vercelTeamId`. The response contains `created`, `appId`, `credentialId`, `keyId`, `issuer`, `audience`, `tokenEndpoint`, and `ingestEndpoint`. New registrations return 201; identical retries return 200. All responses use `Cache-Control: no-store`.

Registration atomically creates the app, an owners group, active group memberships, default notification policy (MEDIUM, urgent central copy and central fallback enabled), and the public-key credential. It creates no invitation secret and does not set an authentication timestamp merely because registration succeeded. The source application must sign an assertion to obtain its own five-minute access token.

The stable identity is the Vercel team/project/environment binding and slug. Retrying with the same active key preserves IDs, ownership, URL, and policy. Another key, another binding, an existing manual/legacy app, or a suspended/deleted app conflicts. Registration is not a credential rotation or app-reactivation mechanism.

### One-time provisioning setup

Configure `SUPPORT_TOWER_REGISTRATION_TOKEN_SHA256` (SHA-256 digest of a random 32-byte base64url token), `SUPPORT_TOWER_REGISTRATION_ACTOR_ID` (existing active ADMIN), and `SUPPORT_TOWER_REGISTRATION_TEAM_ID` on the tower, then deploy. Keep the raw token in `~/.config/support-tower/registration.json`, mode 0600, alongside `towerUrl`, `vercelTeamId`, and the default `ownerIds` array. Never print the profile or commit it. Vercel team membership does not by itself authorize registration; the registrar is a trusted principal and the local script independently verifies Vercel project ownership.

The skill script keeps a mode-0600 private-key recovery record outside the source repo before making its first request. It writes app credentials into the requested Vercel environment through stdin, never places the provisioning token in a source app, and never overwrites existing private keys. Repeated runs repair missing configuration with the same key. Keep the recovery record after success.

### Completion criteria

`credentialsVerified: true` means the local bootstrap obtained an app access token; it does not prove the deployed connector is installed. Install/adapt the source application's server-only versioned escalation adapter and a real `/api/support-tower/status` check before using `--deploy`. That check must obtain a token server-side and return only `{connected: true, appId}` with no-store caching, or a non-2xx failure. Registration alone does not configure legacy export/pull synchronization. The script reports `connectorVerified: true` only after deployment and this check succeed.
