import { sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db'

export interface AuditHistoryRow {
  id: string; actorType: string; actorId: string | null; action: string; subjectType: string; subjectId: string | null
  reason: string | null; createdAt: Date
}
export interface AuditHistoryPage { rows: AuditHistoryRow[]; nextCursor: string | null }
export interface CredentialSecurityRow { id: string; appName: string; thumbprint: string; status: string; validUntil: Date | null; revokedAt: Date | null }

export async function getAuditHistory({ db = getDb(), cursor, limit }: { db?: Db; cursor?: string; limit: 50 }): Promise<AuditHistoryPage> {
  if (limit !== 50) throw new Error('Audit history page size must be 50')
  const decoded = cursor ? decodeCursor(cursor) : null
  const result = await db.execute<AuditRowDb>(sql`
    select id, actor_type as "actorType", actor_id as "actorId", action, subject_type as "subjectType", subject_id as "subjectId",
           metadata->>'reason' as reason, created_at as "createdAt"
      from audit_events
     where (${decoded?.createdAt ?? null}::timestamptz is null or (created_at, id) < (${decoded?.createdAt ?? null}, ${decoded?.id ?? null}))
     order by created_at desc, id desc limit ${limit + 1}
  `)
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit).map((row) => ({ ...row, createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt) }))
  const last = rows.at(-1)
  return { rows, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null }
}

export async function listCredentialSecurity(db: Db = getDb()): Promise<CredentialSecurityRow[]> {
  const result = await db.execute<CredentialDbRow>(sql`
    select credential.id, app.name as "appName", credential.public_key_thumbprint as thumbprint,
           credential.status::text as status, credential.valid_until as "validUntil", credential.revoked_at as "revokedAt"
      from app_credentials credential join source_apps app on app.id = credential.source_app_id
     order by app.name, credential.created_at desc, credential.id desc
  `)
  return result.rows.map((row) => ({ ...row, validUntil: asDate(row.validUntil), revokedAt: asDate(row.revokedAt) }))
}

interface AuditRowDb extends Record<string, unknown> { id: string; actorType: string; actorId: string | null; action: string; subjectType: string; subjectId: string | null; reason: string | null; createdAt: Date | string }
interface CredentialDbRow extends Record<string, unknown> { id: string; appName: string; thumbprint: string; status: string; validUntil: Date | string | null; revokedAt: Date | string | null }
function asDate(value: Date | string | null): Date | null { return value === null ? null : value instanceof Date ? value : new Date(value) }
function encodeCursor(createdAt: Date, id: string): string { return Buffer.from(JSON.stringify({ v: 1, t: createdAt.toISOString(), i: id })).toString('base64url') }
function decodeCursor(value: string): { createdAt: Date; id: string } | null {
  try { const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null; const item = decoded as Record<string, unknown>; const createdAt = typeof item.t === 'string' ? new Date(item.t) : null; return item.v === 1 && createdAt && Number.isFinite(createdAt.getTime()) && createdAt.toISOString() === item.t && typeof item.i === 'string' && item.i ? { createdAt, id: item.i } : null } catch { return null }
}
