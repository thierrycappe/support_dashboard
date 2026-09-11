import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDbPool, getDb } from '@/lib/db'
import { changeApplicationLifecycle, type ApplicationOperation } from '@/lib/apps/lifecycle'
import { createApplicationEnrollment, getApplicationDetail, getApplications } from '@/lib/apps/queries'
import { getActiveCredential } from '@/lib/service-auth/credentials'
import { consumeInvitation } from '@/lib/service-auth/invitations'
import { acceptLegacyPayload } from '@/lib/escalations/legacy'
import { requireTestDatabaseUrl } from './helpers/database'

process.env.DATABASE_URL = requireTestDatabaseUrl()
process.env.SUPPORT_TOWER_PUBLIC_URL = 'https://support.example.test'
const now = new Date('2026-09-11T10:00:00Z')
let appId: string
let originalSecret: string
beforeEach(async () => {
  await getDb().execute(sql`truncate table source_apps, support_groups, support_users cascade`)
  await getDb().execute(sql`insert into support_users (id,email,name,role,status,password_hash,created_at,updated_at) values ('admin-1','admin@example.test','Admin','ADMIN','ACTIVE','hash',${now},${now})`)
  const result = await createApplicationEnrollment({ actorId: 'admin-1', correlationId: randomUUID(), name: 'Atlas', slug: 'atlas', baseUrl: null, environment: 'test', ownerIds: ['admin-1'], minimumPriority: 'HIGH', urgentCentralCopy: true, fallbackToCentral: true, now })
  appId = result.appId; originalSecret = result.invitation.secret
})
afterAll(closeDbPool)
const change = (operation: ApplicationOperation) => changeApplicationLifecycle({ appId, operation, actorId: 'admin-1', correlationId: randomUUID(), now: new Date(now.getTime() + 1000) })
const ingest = () => acceptLegacyPayload({
  authoritativeAppSlug: 'atlas', scheduleDeliveryWakeup: () => undefined,
  payload: { app: { slug: 'atlas', name: 'Atlas', environment: 'test' }, ticket: { externalId: 'ticket-1', kind: 'BUG', status: 'NEW', priority: 'HIGH', title: 'Broken', description: 'Details', remoteUpdatedAt: now.toISOString() } },
})
it('replaces an invitation atomically without changing identity, ownership, or policy', async () => {
  const before = await getApplicationDetail(appId, getDb(), now)
  const { invitation } = await change('resubmit')
  expect(invitation?.secret).not.toBe(originalSecret)
  await expect(consumeInvitation({ secret: originalSecret, now })).rejects.toThrow('no longer valid')
  const after = await getApplicationDetail(appId, getDb(), now)
  expect(after).toMatchObject({ id: appId, owners: before!.owners, minimumPriority: 'HIGH', invitation: { id: invitation!.id } })
  const audit = await getDb().execute(sql`select metadata from audit_events where subject_id=${appId}`)
  expect(JSON.stringify(audit.rows)).not.toContain(invitation!.secret)
  await expect(consumeInvitation({ secret: invitation!.secret, now })).resolves.toMatchObject({ sourceAppId: appId })
})
it('rolls back invitation replacement when the audit fails', async () => {
  await expect(changeApplicationLifecycle({ appId, operation: 'resubmit', actorId: 'admin-1', correlationId: ' ', now })).rejects.toThrow()
  await expect(consumeInvitation({ secret: originalSecret, now })).resolves.toMatchObject({ sourceAppId: appId })
})
it('suspends both new and duplicate legacy push/pull intake and resumes pending enrollment', async () => {
  await ingest()
  await change('suspend')
  await expect(ingest()).rejects.toMatchObject({ code: 'APPLICATION_UNAVAILABLE' })
  await expect(change('resubmit')).rejects.toThrow('Only pending')
  expect(await getApplicationDetail(appId, getDb(), now)).toMatchObject({ status: 'PAUSED', enrollmentStatus: 'PENDING' })
  await change('resume')
  expect(await getApplicationDetail(appId, getDb(), now)).toMatchObject({ status: 'ACTIVE', enrollmentStatus: 'PENDING' })
  await expect(ingest()).resolves.toMatchObject({ result: 'duplicate' })
})
it('deletes from administration, revokes access, and preserves ticket and audit history', async () => {
  const ticket = await ingest()
  await getDb().execute(sql`insert into app_credentials (id,source_app_id,public_jwk,public_key_thumbprint,status,valid_from,created_at) values ('key-1',${appId},'{}','thumbprint','ACTIVE',${now},${now})`)
  await change('delete')
  expect(await getApplications()).toEqual([])
  expect(await getApplicationDetail(appId)).toBeNull()
  expect((await getDb().execute(sql`select id from feedback_tickets where id=${ticket.ticketId}`)).rows).toHaveLength(1)
  expect((await getDb().execute(sql`select id from audit_events where subject_id=${appId} and action='APP_DELETED'`)).rows).toHaveLength(1)
  expect((await getDb().execute(sql`select status from app_credentials where id='key-1'`)).rows).toEqual([{ status: 'REVOKED' }])
  await expect(consumeInvitation({ secret: originalSecret, now })).rejects.toThrow('no longer valid')
  await expect(ingest()).rejects.toMatchObject({ code: 'APPLICATION_UNAVAILABLE' })
  for (const operation of ['resume', 'resubmit', 'suspend', 'delete'] as const) await expect(change(operation)).rejects.toThrow('no longer available')
})
it('rejects resubmission for an active enrollment and stale suspend/resume transitions', async () => {
  await expect(change('resume')).rejects.toThrow('status has changed')
  await getDb().execute(sql`update source_apps set enrollment_status='ACTIVE' where id=${appId}`)
  await expect(change('resubmit')).rejects.toThrow('Only pending')
  await change('suspend')
  await expect(change('suspend')).rejects.toThrow('status has changed')
  await change('resume')
  expect(await getApplicationDetail(appId)).toMatchObject({ enrollmentStatus: 'ACTIVE', status: 'ACTIVE' })
})

it('suspends public-key authentication without revoking the key, then restores it on resume', async () => {
  const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) }
  await getDb().execute(sql`update source_apps set enrollment_status='ACTIVE', credential_mode='PUBLIC_KEY' where id=${appId}`)
  await getDb().execute(sql`insert into app_credentials (id,source_app_id,public_jwk,public_key_thumbprint,status,valid_from,created_at) values ('public-key',${appId},${JSON.stringify(jwk)}::jsonb,'public-thumbprint','ACTIVE',${now},${now})`)
  expect(await getActiveCredential({ credentialId: 'public-key', now })).not.toBeNull()
  await change('suspend')
  expect(await getActiveCredential({ credentialId: 'public-key', now })).toBeNull()
  await change('resume')
  expect(await getActiveCredential({ credentialId: 'public-key', now })).not.toBeNull()
  await change('delete')
  expect(await getActiveCredential({ credentialId: 'public-key', now })).toBeNull()
})
it('serializes concurrent resubmissions so only one unused invitation remains valid', async () => {
  const results = await Promise.all([change('resubmit'), change('resubmit')])
  const grants = await getDb().execute<{ tokenPrefix: string }>(sql`select token_prefix as "tokenPrefix" from app_enrollment_grants where source_app_id=${appId} and revoked_at is null and consumed_at is null`)
  expect(grants.rows).toHaveLength(1)
  expect(results.some(result => result.invitation!.secret.startsWith(grants.rows[0].tokenPrefix))).toBe(true)
})
