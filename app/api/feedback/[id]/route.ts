import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { feedbackTickets } from '@/lib/db/schema'

const patchSchema = z.object({
  status: z
    .enum([
      'NEW',
      'IN_REVIEW',
      'BACKLOG',
      'PLANNED',
      'IN_PROGRESS',
      'FIXED',
      'SHIPPED',
      'DECLINED',
      'CLOSED',
    ])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 503 })
  }

  const json = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid update payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const now = new Date()
  await getDb()
    .update(feedbackTickets)
    .set({
      ...parsed.data,
      lastStatusChangeAt: parsed.data.status ? now : undefined,
      updatedAt: now,
    })
    .where(eq(feedbackTickets.id, id))

  return NextResponse.json({ ok: true })
}
