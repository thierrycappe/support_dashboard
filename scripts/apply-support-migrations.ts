import { readFile } from 'node:fs/promises'
import { closeDbPool, getDbPool } from '@/lib/db'
import { applyMigration } from '@/lib/db/migrations'

const migrations = await Promise.all([
  '0001_support_portal_core',
  '0002_notification_channel_reporter_context',
].map(async (name) => ({
  name,
  sqlText: await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8'),
})))

try {
  const pool = getDbPool()
  for (const migration of migrations) {
    const result = await applyMigration({ ...migration, pool })
    console.log(`${migration.name}: ${result}`)
  }
} finally {
  await closeDbPool()
}
