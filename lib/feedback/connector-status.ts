import { getIngestTokenForApp, ingestTokenEnvVarForSlug } from '@/lib/feedback/ingest'
import { getSourceAppPullConfig } from '@/lib/feedback/source-pull'

type Env = Record<string, string | undefined>

export interface ConnectorStatus {
  slug: string
  /** Env var the tower reads to authenticate this app's bearer pushes. */
  ingestEnvVar: string
  /** Push half: a token is configured for this slug. */
  ingestConfigured: boolean
  /** Pull half: this slug has a {url, token} entry in the pull JSON. */
  pullConfigured: boolean
  pullUrl: string | null
  /**
   * The token round-trip is lossy: getConfiguredAppSlugForIngestToken recovers
   * a slug by mapping `_` back to `-`, so a slug whose own name contains `_`
   * or whose hyphens do not survive normalizeToken can never be matched — the
   * push 401s no matter how correct the token is.
   */
  slugRoundTrips: boolean
}

/**
 * What the tower can actually do for a slug, read from the live environment
 * rather than the `source_apps` row. An enrolled app whose token var was never
 * added still cannot ingest, and nothing in the database shows that.
 *
 * Only meaningful for LEGACY_BEARER apps; PUBLIC_KEY apps authenticate through
 * app_credentials instead.
 */
export function getConnectorStatus(slug: string, env: Env = process.env): ConnectorStatus {
  const ingestEnvVar = ingestTokenEnvVarForSlug(slug)

  // A malformed pull blob must not take the page down; unreadable config is
  // reported as absent, which is what it amounts to operationally.
  let pullUrl: string | null = null
  try {
    pullUrl = getSourceAppPullConfig(slug, env)?.url ?? null
  } catch {
    pullUrl = null
  }

  const recovered = ingestEnvVar
    .slice('SUPPORT_TOWER_INGEST_TOKEN_'.length)
    .toLowerCase()
    .replace(/_/g, '-')

  return {
    slug,
    ingestEnvVar,
    ingestConfigured: getIngestTokenForApp(slug, env) !== null,
    pullConfigured: pullUrl !== null,
    pullUrl,
    slugRoundTrips: recovered === slug,
  }
}
