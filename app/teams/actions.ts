'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/guards'
import { createChannel, updateChannel } from '@/lib/routing/channels'
import { createGroup, setGroupMembers } from '@/lib/routing/groups'

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
const replacementSchema = z.object({
  channelId: z.string().trim().min(1, 'An alert channel is required'),
  config: z.string().min(1, 'Channel configuration is required').transform((value, context) => {
    try { return JSON.parse(value) as unknown } catch { context.addIssue({ code: 'custom', message: 'Channel configuration must be valid JSON' }); return z.NEVER }
  }),
})
const membershipSchema = z.object({
  groupId: z.string().trim().min(1, 'A technical group is required'),
  memberIds: z.array(z.string().trim().min(1)).default([]),
  recipientRefs: z.array(z.string().trim().min(1)).default([]),
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
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid channel configuration') {
      return {
        status: 'error', message: 'Please correct the highlighted fields',
        fieldErrors: { config: ['Channel configuration is invalid'] },
      }
    }
    return { status: 'error', message: 'Alert channel was not created' }
  }
  revalidatePath('/teams')
  return { status: 'success', message: 'Alert channel created' }
}

export async function setTechnicalGroupMembersAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser()
  const parsed = membershipSchema.safeParse({
    groupId: String(formData.get('groupId') ?? ''),
    memberIds: formData.getAll('memberIds').map(String),
    recipientRefs: formData.getAll('recipientRefs').flatMap((value) => String(value).split(',').map((item) => item.trim()).filter(Boolean)),
  })
  if (!parsed.success) return validationError(parsed.error)

  try {
    await setGroupMembers({
      groupId: parsed.data.groupId,
      members: [
        ...parsed.data.memberIds.map((supportUserId) => ({ supportUserId })),
        ...parsed.data.recipientRefs.map((recipientRef) => ({ recipientRef })),
      ],
      actorId: user.id,
      correlationId: randomUUID(),
      reason: 'Updated technical group members',
    })
  } catch {
    return { status: 'error', message: 'Technical group members were not updated' }
  }
  revalidatePath('/teams')
  return { status: 'success', message: 'Technical group members updated' }
}

export async function replaceAlertChannelSecretAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser()
  const parsed = replacementSchema.safeParse({ channelId: String(formData.get('channelId') ?? ''), config: String(formData.get('config') ?? '') })
  if (!parsed.success) return validationError(parsed.error)
  try {
    await updateChannel({
      id: parsed.data.channelId, config: parsed.data.config, actorId: user.id, correlationId: randomUUID(),
      reason: 'Replaced alert channel configuration',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid channel configuration') return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: { config: ['Channel configuration is invalid'] } }
    return { status: 'error', message: 'Alert channel configuration was not replaced' }
  }
  revalidatePath('/teams')
  return { status: 'success', message: 'Alert channel configuration replaced' }
}

function validationError(error: z.ZodError): ActionState {
  return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: error.flatten().fieldErrors }
}
