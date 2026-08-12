import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

const globalDb = globalThis as typeof globalThis & {
  supportTowerPool?: Pool
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

export function getDbPool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not configured')

  globalDb.supportTowerPool ??= new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  })
  return globalDb.supportTowerPool
}

export function getDb() {
  return drizzle(getDbPool(), { schema })
}

export async function closeDbPool(): Promise<void> {
  if (!globalDb.supportTowerPool) return
  const pool = globalDb.supportTowerPool
  delete globalDb.supportTowerPool
  await pool.end()
}

export type Db = ReturnType<typeof getDb>
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]
