import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { appendAuditEvent, type AuditMutationContext } from '@/lib/audit/events'
import { getDb, type Db } from '@/lib/db'
import { supportGroupMembers, supportGroups } from '@/lib/db/schema'

export interface PublicGroup {
  id: string
  name: string
  status: 'ACTIVE' | 'DISABLED'
  isCentralFallback: boolean
  createdAt: Date
  updatedAt: Date | null
}

export interface PublicGroupMember {
  id: string
  groupId: string
  supportUserId: string | null
  recipientRef: string | null
  role: string
  status: 'ACTIVE' | 'DISABLED'
}

export async function createGroup({
  db = getDb(), name, status = 'ACTIVE', isCentralFallback = false, ...audit
}: AuditMutationContext & {
  db?: Db
  name: string
  status?: 'ACTIVE' | 'DISABLED'
  isCentralFallback?: boolean
}): Promise<PublicGroup> {
  const now = new Date()
  const group = {
    id: nanoid(), name: nonEmpty(name, 'name'), status, isCentralFallback,
    createdAt: now, updatedAt: now,
  }
  await db.transaction(async (tx) => {
    await tx.insert(supportGroups).values(group)
    await appendAuditEvent({
      db: tx, ...audit, action: 'GROUP_CREATED', subjectType: 'support_group', subjectId: group.id,
      metadata: { centralFallback: group.isCentralFallback, status: group.status }, now,
    })
  })
  return group
}

export async function setGroupMembers({
  db = getDb(), groupId, members, ...audit
}: AuditMutationContext & {
  db?: Db
  groupId: string
  members: Array<{ supportUserId?: string | null; recipientRef?: string | null; role?: string; status?: 'ACTIVE' | 'DISABLED' }>
}): Promise<PublicGroupMember[]> {
  const normalized = normalizeMembers(members)
  const now = new Date()
  return db.transaction(async (tx) => {
    const group = await tx.select({ id: supportGroups.id }).from(supportGroups)
      .where(eq(supportGroups.id, groupId)).for('update').limit(1)
    if (!group[0]) throw new Error('Support group not found')

    await tx.delete(supportGroupMembers).where(eq(supportGroupMembers.groupId, groupId))
    const records = normalized.map((member) => ({
      id: nanoid(), groupId, supportUserId: member.supportUserId, recipientRef: member.recipientRef,
      role: member.role, status: member.status, createdAt: now, updatedAt: now,
    }))
    if (records.length > 0) await tx.insert(supportGroupMembers).values(records)
    await appendAuditEvent({
      db: tx, ...audit, action: 'GROUP_MEMBERS_SET', subjectType: 'support_group', subjectId: groupId,
      metadata: { memberCount: normalized.length }, now,
    })
    return records.map(({ id, groupId: memberGroupId, supportUserId, recipientRef, role, status }) => ({
      id, groupId: memberGroupId, supportUserId, recipientRef, role, status: status as 'ACTIVE' | 'DISABLED',
    }))
  })
}

function normalizeMembers(input: Array<{ supportUserId?: string | null; recipientRef?: string | null; role?: string; status?: 'ACTIVE' | 'DISABLED' }>) {
  const seen = new Set<string>()
  return input.map((member) => {
    const supportUserId = member.supportUserId?.trim() || null
    const recipientRef = member.recipientRef?.trim() || null
    if ((supportUserId === null) === (recipientRef === null)) throw new Error('A group member needs exactly one identity')
    const identity = supportUserId ? `user:${supportUserId}` : `recipient:${recipientRef}`
    if (seen.has(identity)) throw new Error('Duplicate group member')
    seen.add(identity)
    return { supportUserId, recipientRef, role: member.role?.trim() || 'MEMBER', status: member.status ?? 'ACTIVE' as const }
  })
}

function nonEmpty(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}
