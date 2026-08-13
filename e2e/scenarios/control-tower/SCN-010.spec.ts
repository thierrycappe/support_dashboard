// scaffold:scenario:SCN-010:c1eb6b44
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '../../helpers/fixtures'
import { waitForApplicationDeliveriesToSettle } from '../../helpers/delivery-settlement'

test('SCN-010 — legacy POST and full pull both create durable delivery work', async ({ request, scenario }) => {
  const runtime = JSON.parse(await readFile(resolve(process.cwd(), 'playwright/.runtime/source-pull.json'), 'utf8')) as {
    appSlug: string
    externalId: string
  }
  const appId = `${scenario.id}-legacy-app`
  const groupId = `${scenario.id}-legacy-group`
  const channelId = `${scenario.id}-legacy-channel`
  try {
    await scenario.db.query(`
      insert into support_groups (id,name,status,is_central_fallback,created_at,updated_at)
      values ($1,$2,'ACTIVE',false,now(),now())
    `, [groupId, `${scenario.id} legacy owners`])
    await scenario.db.query(`
      insert into source_apps (id,slug,name,environment,status,enrollment_status,credential_mode,technical_group_id,created_at,updated_at)
      values ($1,$2,'E2E legacy','test','ACTIVE','PENDING','LEGACY_BEARER',$3,now(),now())
    `, [appId, runtime.appSlug, groupId])
    await scenario.db.query(`
      insert into notification_channels
        (id,group_id,name,type,status,encrypted_config,config_nonce,config_auth_tag,key_version,redacted_destination,created_at,updated_at)
      values ($1,$2,'E2E legacy channel','EMAIL','ACTIVE','e2e','e2e','e2e',1,'e2e@example.test',now(),now())
    `, [channelId, groupId])
    await scenario.db.query(`
      insert into app_notification_policies
        (id,source_app_id,minimum_priority,urgent_central_copy,fallback_to_central,created_at,updated_at)
      values ($1,$2,'LOW',false,true,now(),now())
    `, [`${scenario.id}-legacy-policy`, appId])
    const direct = await request.post('/api/feedback/ingest', {
      headers: { authorization: 'Bearer task22-fictional-legacy-token', 'idempotency-key': `${scenario.id}-direct` },
      data: legacyPayload(runtime.appSlug, `${scenario.id}-direct`, 'Direct legacy durable delivery'),
    })
    expect(direct.status()).toBe(201)
    const cron = await request.get('/api/cron/sync-source-apps', {
      headers: { authorization: 'Bearer task22-fictional-cron-secret' },
    })
    expect(cron.status()).toBe(200)
    expect(await cron.json()).toMatchObject({ ok: true, apps: [{ appSlug: runtime.appSlug, pulled: 1, created: 1, errors: [] }] })
    const durable = await scenario.db.query(`
      select ticket.external_id from delivery_outbox outbox
      join escalation_events event on event.id=outbox.escalation_event_id
      join feedback_tickets ticket on ticket.id=event.ticket_id
      where ticket.source_app_id=$1 order by ticket.external_id
    `, [appId])
    expect(durable.rows.map((row) => row.external_id)).toEqual([`${scenario.id}-direct`, runtime.externalId].sort())
  } finally {
    await waitForApplicationDeliveriesToSettle({ db: scenario.db, appId })
    await scenario.db.query(`delete from source_apps where id=$1`, [appId])
    await scenario.db.query(`delete from support_groups where id=$1`, [groupId])
  }
})

function legacyPayload(appSlug: string, externalId: string, title: string) {
  const now = new Date().toISOString()
  return { app: { slug: appSlug, name: 'E2E legacy', environment: 'test' }, ticket: {
    externalId, kind: 'BUG', status: 'NEW', priority: 'HIGH', title, description: 'Fictional legacy E2E description',
    remoteCreatedAt: now, remoteUpdatedAt: now, lastStatusChangeAt: now,
  } }
}
