import { readFile } from 'node:fs/promises'
import { closeDbPool, getDbPool } from '@/lib/db'
import { applyMigration } from '@/lib/db/migrations'

const name = '0001_support_portal_core'
const sqlText = await readFile(
  new URL('../drizzle/0001_support_portal_core.sql', import.meta.url),
  'utf8',
)

try {
  const result = await applyMigration({ name, sqlText, pool: getDbPool() })
  console.log(`${name}: ${result}`)
} finally {
  await closeDbPool()
}
