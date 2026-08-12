// scaffold:scenario:SCN-007:39793362
import { createServer } from 'node:http'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@/lib/db/schema'
import { claimLegacyDeliveries, finishDelivery } from '@/lib/delivery/repository'
import type { Db } from '@/lib/db'
import { expect, test } from '../../helpers/fixtures'

test('SCN-007 — a provider failure retries visibly and recovery becomes sent', async ({ page, scenario }) => {
  const deliveryId = `${scenario.id}-delivery`
  await scenario.db.query(`delete from source_apps where id like 'task22-%'`)
  await seedDelivery(scenario, deliveryId)
  let recovered = false
  const provider = createServer((_request, response) => {
    response.writeHead(recovered ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify(recovered ? { id: 'provider-message-e2e', status: 'accepted' } : { error: { code: 'temporary_unavailable', message: 'Retry later' } }))
  })
  await new Promise<void>((resolve, reject) => provider.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Provider double did not bind')
  const send = async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/deliveries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: deliveryId }) })
    const body = await response.json() as { id?: string }
    return response.ok
      ? { result: 'sent' as const, providerStatus: response.status, providerMessageId: body.id ?? null, retryAfterMs: null, sanitizedError: null }
      : { result: 'retryable' as const, providerStatus: response.status, providerMessageId: null, retryAfterMs: 1, sanitizedError: `HTTP_${response.status}` }
  }
  try {
    const db = drizzle(scenario.db, { schema })
    await dispatchOne(db, send)
    await page.goto('/deliveries?view=retrying')
    await expect(page.getByText('HTTP_503')).toBeVisible()
    await expect(page.getByText('Retrying', { exact: true })).toBeVisible()

    recovered = true
    await scenario.db.query(`update delivery_outbox set next_attempt_at=now() where id=$1`, [deliveryId])
    await dispatchOne(db, send)
    await page.goto('/deliveries?view=history')
    await expect(page.getByText('Sent', { exact: true })).toBeVisible()
    const attempts = await scenario.db.query(`select result_class,provider_status,provider_message_id from delivery_attempts where outbox_id=$1 order by ordinal`, [deliveryId])
    expect(attempts.rows).toEqual([
      expect.objectContaining({ result_class: 'retryable', provider_status: '503' }),
      expect.objectContaining({ result_class: 'sent', provider_status: '200', provider_message_id: 'provider-message-e2e' }),
    ])
  } finally { await new Promise<void>((resolve) => provider.close(() => resolve())) }
})

async function seedDelivery({ db, id }: { db: import('pg').Pool; id: string }, deliveryId: string) {
  const ticketId = `${id}-ticket`; const eventId = `${id}-event`
  await db.query(`insert into source_apps (id,slug,name,environment,status,enrollment_status,credential_mode,created_at,updated_at) values ($1,$1,'Delivery recovery app','test','ACTIVE','PENDING','LEGACY_BEARER',now(),now())`, [id])
  await db.query(`insert into feedback_tickets (id,source_app_id,external_id,kind,status,priority,title,description,raw_payload,triage,last_synced_at,created_at,updated_at) values ($1,$2,$1,'BUG','NEW','HIGH','Provider recovery','Fictional','{}','{"ownerRef":"e2e","ownerName":null,"escalatedAt":"2026-08-13T00:00:00.000Z"}',now(),now(),now())`, [ticketId, id])
  await db.query(`insert into escalation_events (id,ticket_id,generation,event_key,payload,created_at) values ($1,$2,1,$1,'{}',now())`, [eventId, ticketId])
  await db.query(`insert into delivery_outbox (id,escalation_event_id,generation,event_key,target_key,channel_type,config_source,rendered_payload,status,next_attempt_at,attempt_count,created_at,updated_at) values ($1,$2,1,$2,'legacy:central-pushover','PUSHOVER','LEGACY_ENV',$3,'PENDING',now(),0,now(),now())`, [deliveryId, eventId, JSON.stringify({ eventId, appId: id, appName: 'Delivery recovery app', ticketId, kind: 'BUG', priority: 'HIGH', title: 'Provider recovery', portalUrl: 'https://support.e2e.test/feedback/test', reporterContext: null })])
}

async function dispatchOne(db: Db, send: () => Promise<{
  result: 'sent' | 'retryable'; providerStatus: number; providerMessageId: string | null; retryAfterMs: number | null; sanitizedError: string | null
}>) {
  const workerId = `task22-worker-${crypto.randomUUID()}`
  const [job] = await claimLegacyDeliveries({ db, limit: 1, now: new Date(Date.now() + 60_000), workerId })
  expect(job).toBeDefined()
  const startedAt = new Date()
  const result = await send()
  expect(await finishDelivery({ db, id: job!.id, workerId, startedAt, finishedAt: new Date(), result })).toBe(true)
}
