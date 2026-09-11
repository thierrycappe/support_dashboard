import { sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db'
import { appendAuditEvent } from '@/lib/audit/events'
import { createInvitation } from '@/lib/service-auth/invitations'

export type ApplicationOperation = 'resubmit' | 'suspend' | 'resume' | 'delete'

export class ApplicationLifecycleError extends Error {}

export async function changeApplicationLifecycle({
  appId, operation, actorId, correlationId, db = getDb(), now = new Date(),
}: {
  appId: string; operation: ApplicationOperation; actorId: string; correlationId: string; db?: Db; now?: Date
}) {
  return db.transaction(async (tx) => {
    const app = (await tx.execute<{ status: string; enrollmentStatus: string }>(sql`
      select status, enrollment_status as "enrollmentStatus" from source_apps where id=${appId} for update
    `)).rows[0]
    if (!app || app.enrollmentStatus === 'REVOKED') {
      throw new ApplicationLifecycleError('Application is no longer available. Refresh the applications list.')
    }
    if (operation === 'resubmit' && (app.enrollmentStatus !== 'PENDING' || app.status !== 'ACTIVE')) {
      throw new ApplicationLifecycleError('Only pending, unsuspended applications can be resubmitted. Refresh the page.')
    }
    if ((operation === 'suspend' && app.status !== 'ACTIVE') || (operation === 'resume' && app.status !== 'PAUSED')) {
      throw new ApplicationLifecycleError('Application status has changed. Refresh the page and try again.')
    }
    if (operation === 'resubmit' || operation === 'delete') {
      await tx.execute(sql`
        update app_enrollment_grants set revoked_at=${now}
         where source_app_id=${appId} and consumed_at is null and revoked_at is null
      `)
    }
    if (operation === 'delete') {
      await tx.execute(sql`
        update app_credentials set status='REVOKED', revoked_at=${now}, valid_until=${now}, revoked_by_user_id=${actorId}
         where source_app_id=${appId} and revoked_at is null
      `)
      await tx.execute(sql`update source_apps set status='PAUSED', enrollment_status='REVOKED', updated_at=${now} where id=${appId}`)
    } else if (operation === 'suspend' || operation === 'resume') {
      // Preserve enrollment state so pending apps remain pending when resumed.
      await tx.execute(sql`update source_apps set status=${operation === 'suspend' ? 'PAUSED' : 'ACTIVE'}::"AppStatus", updated_at=${now} where id=${appId}`)
    }
    const invitation = operation === 'resubmit'
      ? await createInvitation({ db: tx as unknown as Db, sourceAppId: appId, createdByUserId: actorId, now })
      : null
    const actions = { resubmit: 'APP_ENROLLMENT_RESUBMITTED', suspend: 'APP_SUSPENDED', resume: 'APP_RESUMED', delete: 'APP_DELETED' }
    await appendAuditEvent({
      db: tx, actorId, correlationId, action: actions[operation], reason: `Application ${operation}`,
      subjectType: 'source_app', subjectId: appId, now,
    })
    return { invitation }
  })
}
