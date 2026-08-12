// scaffold:scenario:SCN-010:c1eb6b44
import { expect, test } from '../../helpers/fixtures'
import { pullSourceApp } from '@/lib/feedback/source-pull'
import { Agent } from 'undici'

test('SCN-010 — legacy POST and full pull both create durable delivery work', async ({ request, scenario }) => {
  await scenario.db.query(`delete from source_apps where slug='e2e-legacy'`)
  const groupId = `${scenario.id}-legacy-group`
  const channelId = `${scenario.id}-legacy-channel`
  await scenario.db.query(`
    insert into support_groups (id,name,status,is_central_fallback,created_at,updated_at)
    values ($1,$2,'ACTIVE',false,now(),now())
  `, [groupId, `${scenario.id} legacy owners`])
  await scenario.db.query(`
    insert into source_apps (id,slug,name,environment,status,enrollment_status,credential_mode,technical_group_id,created_at,updated_at)
    values ($1,'e2e-legacy','E2E legacy','test','ACTIVE','PENDING','LEGACY_BEARER',$2,now(),now())
  `, [`${scenario.id}-legacy-app`, groupId])
  await scenario.db.query(`
    insert into notification_channels
      (id,group_id,name,type,status,encrypted_config,config_nonce,config_auth_tag,key_version,redacted_destination,created_at,updated_at)
    values ($1,$2,'E2E legacy channel','EMAIL','ACTIVE','e2e','e2e','e2e',1,'e2e@example.test',now(),now())
  `, [channelId, groupId])
  await scenario.db.query(`
    insert into app_notification_policies
      (id,source_app_id,minimum_priority,urgent_central_copy,fallback_to_central,created_at,updated_at)
    values ($1,$2,'LOW',false,true,now(),now())
  `, [`${scenario.id}-legacy-policy`, `${scenario.id}-legacy-app`])
  const direct = await request.post('/api/feedback/ingest', {
    headers: { authorization: 'Bearer task22-fictional-legacy-token', 'idempotency-key': `${scenario.id}-direct` },
    data: legacyPayload(`${scenario.id}-direct`, 'Direct legacy durable delivery'),
  })
  expect(direct.status()).toBe(201)
  const pulled = await pullSourceApp({
    appSlug: 'e2e-legacy', env: { SUPPORT_TOWER_SOURCE_APP_PULL_JSON: JSON.stringify({ 'e2e-legacy': { url: 'https://source.example.test/tickets', token: 'fictional-pull-token' } }) },
    validateTarget: async (url) => ({ url: new URL(url), addresses: ['93.184.216.34'], dispatcher: new Agent() }),
    fetchImpl: async () => Response.json({ tickets: [legacyPayload('task22-full-pull', 'Full pull durable delivery')] }),
    accept: async (payload) => {
      const response = await request.post('/api/feedback/ingest', {
        headers: { authorization: 'Bearer task22-fictional-legacy-token', 'idempotency-key': `${scenario.id}-pull` }, data: payload,
      })
      expect(response.status()).toBe(201)
      const result = await response.json() as { appId: string; ticketId: string; created: boolean }
      return result
    },
  })
  expect(pulled).toMatchObject({ appSlug: 'e2e-legacy', created: 1, errors: [] })
  const durable = await scenario.db.query(`
    select ticket.external_id from delivery_outbox outbox
    join escalation_events event on event.id=outbox.escalation_event_id
    join feedback_tickets ticket on ticket.id=event.ticket_id
    where ticket.source_app_id=$1 order by ticket.external_id
  `, [`${scenario.id}-legacy-app`])
  expect(durable.rows.map((row) => row.external_id)).toEqual([`${scenario.id}-direct`, 'task22-full-pull'].sort())
})

function legacyPayload(externalId: string, title: string) {
  const now = new Date().toISOString()
  return { app: { slug: 'e2e-legacy', name: 'E2E legacy', environment: 'test' }, ticket: {
    externalId, kind: 'BUG', status: 'NEW', priority: 'HIGH', title, description: 'Fictional legacy E2E description',
    remoteCreatedAt: now, remoteUpdatedAt: now, lastStatusChangeAt: now,
  } }
}
