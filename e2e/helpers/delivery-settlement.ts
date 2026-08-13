type QueryResult = { rows: Array<{ unsettled: number | string }> }
type DeliverySettlementDb = {
  query: (text: string, values: unknown[]) => Promise<QueryResult>
}

export async function waitForApplicationDeliveriesToSettle({
  db,
  appId,
  timeoutMs = 10_000,
  pollMs = 25,
  now = Date.now,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  db: DeliverySettlementDb
  appId: string
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}): Promise<void> {
  const deadline = now() + Math.max(1, timeoutMs)
  const interval = Math.max(1, pollMs)
  while (true) {
    const result = await db.query(`
      select count(*)::int as unsettled
        from delivery_outbox outbox
        join escalation_events event on event.id = outbox.escalation_event_id
        join feedback_tickets ticket on ticket.id = event.ticket_id
       where ticket.source_app_id = $1
         and outbox.status in ('PENDING', 'LEASED', 'RETRYING')
    `, [appId])
    if (Number(result.rows[0]?.unsettled ?? 0) === 0) return
    if (now() >= deadline) throw new Error('Fixture deliveries did not settle')
    await wait(Math.min(interval, Math.max(1, deadline - now())))
  }
}
