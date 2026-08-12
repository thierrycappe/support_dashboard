import { and, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent } from '@/lib/audit/events'
import { getDb, type Db } from '@/lib/db'
import { appNotificationPolicies, sourceApps, supportGroupMembers, supportGroups, supportUsers } from '@/lib/db/schema'
import type { FeedbackPriority } from '@/lib/feedback/status'
import { createInvitation, type CreatedInvitation } from '@/lib/service-auth/invitations'
import { canonicalApprovedTriageSql } from '@/lib/escalations/approval'
import { requireSafeApplicationBaseUrl, safeApplicationBaseUrl } from '@/lib/apps/validation'

export interface ApplicationListRow {
  id: string
  name: string
  slug: string
  environment: string
  status: string
  enrollmentStatus: string
  groupName: string
  openCount: number
  lastAuthenticatedAt: Date | null
}

export interface ApplicationDetail extends ApplicationListRow {
  baseUrl: string | null
  credentialMode: string
  slugLocked: true
  minimumPriority: FeedbackPriority | null
  urgentCentralCopy: boolean | null
  fallbackToCentral: boolean | null
  owners: Array<{ id: string; name: string; email: string }>
  invitation: null | { id: string; prefix: string; status: 'AVAILABLE' | 'CONSUMED' | 'REVOKED' | 'EXPIRED'; expiresAt: Date; consumedAt: Date | null }
}

export async function getApplications(db: Db = getDb()): Promise<ApplicationListRow[]> {
  const approved = canonicalApprovedTriageSql(sql`ticket.triage`)
  const result = await db.execute<ApplicationListRow & Record<string, unknown>>(sql`
    select app.id, app.name, app.slug, app.environment, app.status,
           app.enrollment_status as "enrollmentStatus", coalesce(group_row.name, 'Unassigned') as "groupName",
           count(ticket.id) filter (where ticket.status in ('NEW','IN_REVIEW','BACKLOG','PLANNED','IN_PROGRESS') and ${approved})::int as "openCount",
           app.last_authenticated_at as "lastAuthenticatedAt"
      from source_apps app
      left join support_groups group_row on group_row.id=app.technical_group_id
      left join feedback_tickets ticket on ticket.source_app_id=app.id
     group by app.id, group_row.name
     order by app.name, app.id
  `)
  return result.rows.map((row) => ({ ...row, openCount: Number(row.openCount), lastAuthenticatedAt: asDate(row.lastAuthenticatedAt) }))
}

export async function getActiveApplicationOwners(db: Db = getDb()): Promise<Array<{ id: string; name: string; email: string }>> {
  const result = await db.execute<{ id: string; name: string; email: string } & Record<string, unknown>>(sql`
    select id, name, email from support_users where status='ACTIVE' order by name, id
  `)
  return result.rows
}

export async function getApplicationDetail(id: string, db: Db = getDb(), now = new Date()): Promise<ApplicationDetail | null> {
  const approved = canonicalApprovedTriageSql(sql`ticket.triage`)
  const result = await db.execute<(ApplicationDetail & { invitationId: string | null; invitationPrefix: string | null; invitationExpiresAt: Date | string | null; invitationConsumedAt: Date | string | null; invitationRevokedAt: Date | string | null }) & Record<string, unknown>>(sql`
    select app.id, app.name, app.slug, app.base_url as "baseUrl", app.environment, app.status,
           app.enrollment_status as "enrollmentStatus", app.credential_mode as "credentialMode",
           coalesce(group_row.name, 'Unassigned') as "groupName", app.last_authenticated_at as "lastAuthenticatedAt",
           (select count(*)::int from feedback_tickets ticket where ticket.source_app_id=app.id and ticket.status in ('NEW','IN_REVIEW','BACKLOG','PLANNED','IN_PROGRESS') and ${approved}) as "openCount",
           policy.minimum_priority as "minimumPriority", policy.urgent_central_copy as "urgentCentralCopy", policy.fallback_to_central as "fallbackToCentral",
           grant_row.id as "invitationId", grant_row.token_prefix as "invitationPrefix", grant_row.expires_at as "invitationExpiresAt",
           grant_row.consumed_at as "invitationConsumedAt", grant_row.revoked_at as "invitationRevokedAt"
      from source_apps app
      left join support_groups group_row on group_row.id=app.technical_group_id
      left join app_notification_policies policy on policy.source_app_id=app.id
      left join lateral (select * from app_enrollment_grants where source_app_id=app.id order by created_at desc, id desc limit 1) grant_row on true
     where app.id=${id}
  `)
  const row = result.rows[0]
  if (!row) return null
  const expiresAt = asDate(row.invitationExpiresAt)
  const consumedAt = asDate(row.invitationConsumedAt)
  const revokedAt = asDate(row.invitationRevokedAt)
  const owners = await db.execute<{ id: string; name: string; email: string } & Record<string, unknown>>(sql`
    select user_row.id, user_row.name, user_row.email from source_apps app
      join support_group_members member on member.group_id=app.technical_group_id and member.status='ACTIVE'
      join support_users user_row on user_row.id=member.support_user_id
     where app.id=${id} order by user_row.name, user_row.id
  `)
  return {
    id: row.id, name: row.name, slug: row.slug, baseUrl: safeApplicationBaseUrl(row.baseUrl), environment: row.environment,
    status: row.status, enrollmentStatus: row.enrollmentStatus, credentialMode: row.credentialMode,
    groupName: row.groupName, openCount: Number(row.openCount), lastAuthenticatedAt: asDate(row.lastAuthenticatedAt),
    slugLocked: true, minimumPriority: row.minimumPriority, urgentCentralCopy: row.urgentCentralCopy,
    fallbackToCentral: row.fallbackToCentral, owners: owners.rows,
    invitation: row.invitationId && row.invitationPrefix && expiresAt ? {
      id: row.invitationId, prefix: row.invitationPrefix,
      status: consumedAt ? 'CONSUMED' : revokedAt ? 'REVOKED' : expiresAt <= now ? 'EXPIRED' : 'AVAILABLE',
      expiresAt, consumedAt,
    } : null,
  }
}

export async function createApplicationEnrollment({
  db = getDb(), actorId, correlationId, name, slug, baseUrl, environment, ownerIds,
  minimumPriority, urgentCentralCopy, fallbackToCentral, now = new Date(),
}: {
  db?: Db; actorId: string; correlationId: string; name: string; slug: string; baseUrl: string | null
  environment: string; ownerIds: string[]; minimumPriority: FeedbackPriority
  urgentCentralCopy: boolean; fallbackToCentral: boolean; now?: Date
}): Promise<{ appId: string; invitation: CreatedInvitation }> {
  const normalizedBaseUrl = baseUrl === null ? null : requireSafeApplicationBaseUrl(baseUrl)
  const uniqueOwnerIds = [...new Set(ownerIds)]
  if (uniqueOwnerIds.length === 0 || uniqueOwnerIds.length !== ownerIds.length) throw new Error('Valid application owners are required')
  return db.transaction(async (tx) => {
    const validOwners = await tx.select({ id: supportUsers.id }).from(supportUsers)
      .where(and(eq(supportUsers.status, 'ACTIVE'), inArray(supportUsers.id, uniqueOwnerIds)))
    if (validOwners.length !== uniqueOwnerIds.length) throw new Error('Valid application owners are required')

    const appId = nanoid()
    const groupId = nanoid()
    await tx.insert(supportGroups).values({ id: groupId, name: `${name} owners`, status: 'ACTIVE', isCentralFallback: false, createdAt: now, updatedAt: now })
    await tx.insert(sourceApps).values({ id: appId, name, slug, baseUrl: normalizedBaseUrl, environment, status: 'ACTIVE', enrollmentStatus: 'PENDING', credentialMode: 'LEGACY_BEARER', technicalGroupId: groupId, createdAt: now, updatedAt: now })
    await tx.insert(supportGroupMembers).values(uniqueOwnerIds.map((supportUserId) => ({ id: nanoid(), groupId, supportUserId, recipientRef: null, role: 'OWNER', status: 'ACTIVE', createdAt: now, updatedAt: now })))
    await tx.insert(appNotificationPolicies).values({ id: nanoid(), sourceAppId: appId, minimumPriority, urgentCentralCopy, fallbackToCentral, createdAt: now, updatedAt: now })
    const invitation = await createInvitation({ db: tx as unknown as Db, sourceAppId: appId, createdByUserId: actorId, now })
    await appendAuditEvent({ db: tx, actorId, correlationId, reason: 'Created application enrollment', action: 'APP_ENROLLMENT_CREATED', subjectType: 'source_app', subjectId: appId, metadata: { groupId, ownerCount: uniqueOwnerIds.length, minimumPriority, urgentCentralCopy, fallbackToCentral, environment }, now })
    return { appId, invitation }
  })
}

function asDate(value: Date | string | null): Date | null { return value === null ? null : value instanceof Date ? value : new Date(value) }
