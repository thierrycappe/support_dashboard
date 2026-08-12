'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/guards'
import { createChannel } from '@/lib/routing/channels'
import { createGroup } from '@/lib/routing/groups'

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> }

const groupSchema = z.object({
  name: z.string().trim().min(1, 'A group name is required').max(160),
  status: z.enum(['ACTIVE', 'DISABLED']),
  isCentralFallback: z.boolean(),
})
const channelSchema = z.object({
  groupId: z.string().trim().min(1, 'A technical group is required'),
  name: z.string().trim().min(1, 'A channel name is required').max(160),
  type: z.enum(['EMAIL', 'PUSHOVER', 'WEBHOOK']),
  config: z.string().min(1, 'Channel configuration is required').transform((value, context) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      context.addIssue({ code: 'custom', message: 'Channel configuration must be valid JSON' })
      return z.NEVER
    }
  }),
  status: z.enum(['ACTIVE', 'DISABLED', 'UNHEALTHY']),
  includeReporterContext: z.boolean(),
})

export async function createTechnicalGroupAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser()
  const parsed = groupSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    status: String(formData.get('status') ?? 'ACTIVE'),
    isCentralFallback: formData.get('isCentralFallback') === 'on',
  })
  if (!parsed.success) return validationError(parsed.error)

  try {
    await createGroup({
      ...parsed.data,
      actorId: user.id,
      correlationId: randomUUID(),
      reason: 'Created technical group',
    })
  } catch {
    return { status: 'error', message: 'Technical group was not created' }
  }
  revalidatePath('/teams')
  return { status: 'success', message: 'Technical group created' }
}

export async function createAlertChannelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser()
  const parsed = channelSchema.safeParse({
    groupId: String(formData.get('groupId') ?? ''),
    name: String(formData.get('name') ?? ''),
    type: String(formData.get('type') ?? ''),
    config: String(formData.get('config') ?? ''),
    status: String(formData.get('status') ?? 'ACTIVE'),
    includeReporterContext: formData.get('includeReporterContext') === 'on',
  })
  if (!parsed.success) return validationError(parsed.error)

  try {
    await createChannel({
      ...parsed.data,
      actorId: user.id,
      correlationId: randomUUID(),
      reason: 'Created alert channel',
    })
  } catch {
    return { status: 'error', message: 'Alert channel was not created' }
  }
  revalidatePath('/teams')
  return { status: 'success', message: 'Alert channel created' }
}

function validationError(error: z.ZodError): ActionState {
  return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: error.flatten().fieldErrors }
}
