import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

export async function applyMigration({
  name,
  sqlText,
  pool,
}: {
  name: string
  sqlText: string
  pool: Pool
}): Promise<'applied' | 'already-applied'> {
  const checksum = createHash('sha256').update(sqlText).digest('hex')
  const client = await pool.connect()

  try {
    await client.query('begin')
    await client.query("select pg_advisory_xact_lock(hashtext('support-tower-migrations'))")
    await client.query(`create table if not exists support_schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`)

    const existing = await client.query<{ checksum: string }>(
      'select checksum from support_schema_migrations where name = $1',
      [name],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${name}`)
      }
      await client.query('commit')
      return 'already-applied'
    }

    await client.query(sqlText)
    await client.query(
      'insert into support_schema_migrations (name, checksum) values ($1, $2)',
      [name, checksum],
    )
    await client.query('commit')
    return 'applied'
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
