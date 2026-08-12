// scaffold:scenario:SCN-007:39793362
import { createServer } from 'node:http'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@/lib/db/schema'
import { dispatchDelivery } from '@/lib/delivery/dispatch'
import { runDeliverySweep } from '@/lib/delivery/worker'
import { expect, test } from '../../helpers/fixtures'

test('SCN-007 — a provider failure retries visibly and recovery becomes sent', async ({ page, scenario }) => {
  const deliveryId = `${scenario.id}-delivery`
  await seedDelivery(scenario, deliveryId)
  // Keep the app's post-response wakeups away from this exact fixture. The
  // production sweep under test advances its clock explicitly to claim it.
  const sweepNow = new Date(Date.now() + 2 * 60 * 60_000)
  let recovered = false
  const providerRequests: URLSearchParams[] = []
  const provider = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      providerRequests.push(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
      response.writeHead(recovered ? 200 : 503, { 'content-type': 'application/json' })
      response.end(JSON.stringify(recovered
        ? { status: 1, request: 'provider-message-e2e' }
        : { status: 0, errors: ['temporary_unavailable'], request: 'provider-failure-e2e' }))
    })
  })
  await new Promise<void>((resolve, reject) => provider.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Provider double did not bind')
  const providerFetch: typeof fetch = (_input, init) => fetch(`http://127.0.0.1:${address.port}/deliveries`, init)
  try {
    const db = drizzle(scenario.db, { schema })
    const first = await runDeliverySweep({
      db, limit: 1, now: sweepNow, workerId: `${scenario.id}-worker-1`, deliveryIds: [deliveryId],
      legacyConfig: { type: 'PUSHOVER', appToken: 'fictional-app-token', userKey: 'fictional-user-key' },
      send: (input) => dispatchDelivery({ ...input, fetchImpl: providerFetch }),
    })
    expect(first).toMatchObject({ claimed: 1, started: 1, retrying: 1 })
    await page.goto('/deliveries?view=retrying')
    await expect(page.getByText('HTTP_503')).toBeVisible()
    await expect(page.getByText('Retrying', { exact: true })).toBeVisible()

    recovered = true
    await scenario.db.query(`update delivery_outbox set next_attempt_at=now()+interval '1 hour' where id=$1`, [deliveryId])
    const second = await runDeliverySweep({
      db, limit: 1, now: sweepNow, workerId: `${scenario.id}-worker-2`, deliveryIds: [deliveryId],
      legacyConfig: { type: 'PUSHOVER', appToken: 'fictional-app-token', userKey: 'fictional-user-key' },
      send: (input) => dispatchDelivery({ ...input, fetchImpl: providerFetch }),
    })
    expect(second).toMatchObject({ claimed: 1, started: 1, sent: 1 })
    await page.goto('/deliveries?view=history')
    const deliveryRow = page.getByRole('region', { name: 'Delivery operations' }).getByRole('row').nth(1)
    await expect(deliveryRow).toContainText('Central compatibility route')
    await expect(deliveryRow.getByText('Sent', { exact: true })).toBeVisible()
    await expect(deliveryRow).toContainText('HTTP_503')
    const attempts = await scenario.db.query(`select result_class,provider_status,provider_message_id from delivery_attempts where outbox_id=$1 order by ordinal`, [deliveryId])
    expect(attempts.rows).toEqual([
      expect.objectContaining({ result_class: 'retryable', provider_status: '503' }),
      expect.objectContaining({ result_class: 'sent', provider_status: '200', provider_message_id: 'provider-message-e2e' }),
    ])
    expect(providerRequests).toHaveLength(2)
    for (const request of providerRequests) {
      expect(request.get('token')).toBe('fictional-app-token')
      expect(request.get('user')).toBe('fictional-user-key')
      expect(request.get('title')).toBe('Provider recovery')
      expect(request.get('url')).toBe('https://support.e2e.test/feedback/test')
    }
  } finally {
    await new Promise<void>((resolve) => provider.close(() => resolve()))
    await cleanupDelivery(scenario, deliveryId)
  }
})

async function seedDelivery({ db, id }: { db: import('pg').Pool; id: string }, deliveryId: string) {
  const ticketId = `${id}-ticket`; const eventId = `${id}-event`
  await db.query(`insert into source_apps (id,slug,name,environment,status,enrollment_status,credential_mode,created_at,updated_at) values ($1,$1,'Delivery recovery app','test','ACTIVE','PENDING','LEGACY_BEARER',now(),now())`, [id])
  await db.query(`insert into feedback_tickets (id,source_app_id,external_id,kind,status,priority,title,description,raw_payload,triage,last_synced_at,created_at,updated_at) values ($1,$2,$1,'BUG','NEW','HIGH','Provider recovery','Fictional','{}','{"ownerRef":"e2e","ownerName":null,"escalatedAt":"2026-08-13T00:00:00.000Z"}',now(),now(),now())`, [ticketId, id])
  await db.query(`insert into escalation_events (id,ticket_id,generation,event_key,payload,created_at) values ($1,$2,1,$1,'{}',now())`, [eventId, ticketId])
  await db.query(`insert into delivery_outbox (id,escalation_event_id,generation,event_key,target_key,channel_type,config_source,rendered_payload,status,next_attempt_at,attempt_count,created_at,updated_at) values ($1,$2,1,$2,'legacy:central-pushover','PUSHOVER','LEGACY_ENV',$3,'PENDING',now()+interval '1 hour',0,now(),now())`, [deliveryId, eventId, JSON.stringify({ eventId, appId: id, appName: 'Delivery recovery app', ticketId, kind: 'BUG', priority: 'HIGH', title: 'Provider recovery', portalUrl: 'https://support.e2e.test/feedback/test', reporterContext: null })])
}

async function cleanupDelivery({ db, id }: { db: import('pg').Pool; id: string }, deliveryId: string) {
  await db.query(`delete from delivery_attempts where outbox_id=$1`, [deliveryId])
  await db.query(`delete from delivery_outbox where id=$1`, [deliveryId])
  await db.query(`delete from escalation_events where id=$1`, [`${id}-event`])
  await db.query(`delete from feedback_tickets where id=$1`, [`${id}-ticket`])
  await db.query(`delete from source_apps where id=$1`, [id])
}
