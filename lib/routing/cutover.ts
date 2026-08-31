import { sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db'

export const ROUTING_CUTOVER_ADVISORY_LOCK = 'support-tower-routing-cutover'
export const LEGACY_PUSHOVER_BRIDGE_RETIRED_MARKER = 'legacy_pushover_bridge_retired_at'

export async function lockRoutingCutover(tx: DbTransaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ROUTING_CUTOVER_ADVISORY_LOCK}))`)
}
