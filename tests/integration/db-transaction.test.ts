import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeDbPool, getDb } from '@/lib/db'
import { requireTestDatabaseUrl } from '@/tests/integration/helpers/database'

let transactionProbeReady = false

beforeAll(async () => {
  process.env.DATABASE_URL = requireTestDatabaseUrl()
  await getDb().execute(sql`create table if not exists transaction_probe (
    id text primary key
  )`)
  await getDb().execute(sql`delete from transaction_probe`)
  transactionProbeReady = true
})

afterAll(async () => {
  if (!transactionProbeReady) return
  await getDb().execute(sql`drop table if exists transaction_probe`)
  await closeDbPool()
})

it('rolls back every statement when a transaction callback fails', async () => {
  await expect(
    getDb().transaction(async (tx) => {
      await tx.execute(sql`insert into transaction_probe (id) values ('rolled-back')`)
      throw new Error('force rollback')
    }),
  ).rejects.toThrow('force rollback')

  const result = await getDb().execute<{ count: number }>(
    sql`select count(*)::int as count from transaction_probe`,
  )
  expect(result.rows[0]?.count).toBe(0)
})
