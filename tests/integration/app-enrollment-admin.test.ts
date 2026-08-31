import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { createApplicationEnrollment, getApplicationDetail, getApplications } from '@/lib/apps/queries'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
const now = new Date('2026-08-12T15:00:00.000Z')

beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups, support_users cascade`)
  await getDb().execute(sql`insert into support_users (id,email,name,role,status,password_hash,created_at,updated_at) values ('admin-1','admin@example.test','Ari Laurent','ADMIN','ACTIVE','hash',${now},${now}), ('owner-1','owner@example.test','Maya Chen','SUPPORT','ACTIVE','hash',${now},${now})`)
})
afterAll(async () => { await closeDbPool() })

describe('application enrollment administration', () => {
  it('atomically creates ownership, policy, digest-only invitation and a sanitized audit', async () => {
    const correlationId = `enroll-${randomUUID()}`
    const result = await createApplicationEnrollment({ db: getDb(), actorId: 'admin-1', correlationId, name: 'Atlas Checkout', slug: 'atlas-checkout', baseUrl: 'https://atlas.example.test', environment: 'production', ownerIds: ['owner-1'], minimumPriority: 'HIGH', urgentCentralCopy: true, fallbackToCentral: false, now })
    const persisted = await getDb().execute<Record<string, unknown>>(sql`
      select app.id, app.technical_group_id as "groupId", app.enrollment_status as "enrollmentStatus", app.credential_mode as "credentialMode",
             policy.minimum_priority as "minimumPriority", grant_row.token_digest as "tokenDigest", grant_row.token_prefix as "tokenPrefix"
        from source_apps app join app_notification_policies policy on policy.source_app_id=app.id
        join app_enrollment_grants grant_row on grant_row.source_app_id=app.id where app.id=${result.appId}
    `)
    expect(persisted.rows[0]).toMatchObject({ enrollmentStatus: 'PENDING', credentialMode: 'LEGACY_BEARER', minimumPriority: 'HIGH', tokenDigest: createHash('sha256').update(result.invitation.secret).digest('hex'), tokenPrefix: result.invitation.secret.slice(0, 8) })
    expect(await count(sql`select count(*)::int as count from support_group_members where group_id=${persisted.rows[0]!.groupId} and support_user_id='owner-1'`)).toBe(1)
    const audit = await getDb().execute<{ metadata: Record<string, unknown> }>(sql`select metadata from audit_events where request_correlation_id=${correlationId} and action='APP_ENROLLMENT_CREATED'`)
    expect(audit.rows).toHaveLength(1)
    expect(JSON.stringify(audit.rows[0])).not.toContain(result.invitation.secret)
    expect(await secretOccurrences(result.invitation.secret)).toBe(0)

    const detail = await getApplicationDetail(result.appId, getDb(), now)
    expect(detail).toMatchObject({ slug: 'atlas-checkout', slugLocked: true, invitation: { id: result.invitation.id, status: 'AVAILABLE' } })
    expect(JSON.stringify(detail)).not.toContain(result.invitation.secret)

    await getDb().execute(sql`update app_enrollment_grants set consumed_at=${now} where id=${result.invitation.id}`)
    await expect(getApplicationDetail(result.appId, getDb(), now)).resolves.toMatchObject({ invitation: { status: 'CONSUMED', consumedAt: now } })
    await getDb().execute(sql`update app_enrollment_grants set consumed_at=null where id=${result.invitation.id}`)
    await expect(getApplicationDetail(result.appId, getDb(), result.invitation.expiresAt)).resolves.toMatchObject({ invitation: { status: 'EXPIRED', consumedAt: null } })
  })

  it('rolls back every enrollment record when the final audit write fails', async () => {
    await expect(createApplicationEnrollment({ db: getDb(), actorId: 'admin-1', correlationId: ' ', name: 'Beacon Billing', slug: 'beacon-billing', baseUrl: 'https://beacon.example.test', environment: 'production', ownerIds: ['owner-1'], minimumPriority: 'MEDIUM', urgentCentralCopy: true, fallbackToCentral: true, now })).rejects.toThrow('correlationId is required')
    expect(await count(sql`select count(*)::int as count from source_apps where slug='beacon-billing'`)).toBe(0)
    expect(await count(sql`select count(*)::int as count from support_groups where name='Beacon Billing owners'`)).toBe(0)
  })

  it('rejects credential-bearing URLs without persistence or detail exposure', async () => {
    await expect(createApplicationEnrollment({ db: getDb(), actorId: 'admin-1', correlationId: randomUUID(), name: 'Unsafe app', slug: 'unsafe-app', baseUrl: 'https://operator:secret@unsafe.example.test', environment: 'production', ownerIds: ['owner-1'], minimumPriority: 'MEDIUM', urgentCentralCopy: true, fallbackToCentral: true, now })).rejects.toThrow('Invalid application URL')
    expect(await count(sql`select count(*)::int as count from source_apps where slug='unsafe-app'`)).toBe(0)
  })

  it('counts only canonically business-approved open escalations', async () => {
    const result = await createApplicationEnrollment({ db: getDb(), actorId: 'admin-1', correlationId: randomUUID(), name: 'Counted app', slug: 'counted-app', baseUrl: 'https://counted.example.test', environment: 'production', ownerIds: ['owner-1'], minimumPriority: 'MEDIUM', urgentCentralCopy: true, fallbackToCentral: true, now })
    await getDb().execute(sql`
      insert into feedback_tickets (id,source_app_id,external_id,kind,status,priority,title,description,raw_payload,triage,last_synced_at,created_at,updated_at) values
      ('approved-ticket',${result.appId},'approved','BUG','NEW','MEDIUM','Approved','Details','{}'::jsonb,'{"ownerRef":"owner","ownerName":null,"escalatedAt":"2026-08-12T15:00:00.000Z"}'::jsonb,${now},${now},${now}),
      ('unapproved-ticket',${result.appId},'unapproved','BUG','NEW','MEDIUM','Unapproved','Details','{}'::jsonb,null,${now},${now},${now}),
      ('malformed-ticket',${result.appId},'malformed','BUG','NEW','MEDIUM','Malformed','Details','{}'::jsonb,'{"ownerRef":"owner","ownerName":null,"escalatedAt":"bad"}'::jsonb,${now},${now},${now})
    `)
    expect(await getApplications(getDb())).toEqual([expect.objectContaining({ id: result.appId, openCount: 1 })])
    await expect(getApplicationDetail(result.appId, getDb(), now)).resolves.toMatchObject({ openCount: 1 })
  })
})

async function count(query: ReturnType<typeof sql>): Promise<number> { const row = await getDb().execute<{ count: number }>(query); return Number(row.rows[0]?.count ?? 0) }
async function secretOccurrences(secret: string): Promise<number> {
  const columns = await getDb().execute<{ tableName: string; columnName: string }>(sql`
    select table_name as "tableName", column_name as "columnName" from information_schema.columns
     where table_schema='public' and data_type in ('text','character varying','json','jsonb')
  `)
  let total = 0
  for (const column of columns.rows) {
    const matches = await getDb().execute<{ count: number }>(sql`
      select count(*)::int as count from ${sql.identifier(column.tableName)}
       where ${sql.identifier(column.columnName)}::text like ${`%${secret}%`}
    `)
    total += Number(matches.rows[0]?.count ?? 0)
  }
  return total
}
