'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/guards'
import { setAppPolicy } from '@/lib/routing/policies'

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> }

const policySchema = z.object({
  sourceAppId: z.string().trim().min(1, 'An application is required'),
  technicalGroupId: z.string().trim().transform((value) => value || null),
  minimumPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  urgentCentralCopy: z.boolean(),
  fallbackToCentral: z.boolean(),
})

export async function updateAppPolicyAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser()
  const parsed = policySchema.safeParse({
    sourceAppId: String(formData.get('sourceAppId') ?? ''),
    technicalGroupId: String(formData.get('technicalGroupId') ?? ''),
    minimumPriority: String(formData.get('minimumPriority') ?? ''),
    urgentCentralCopy: formData.get('urgentCentralCopy') === 'on',
    fallbackToCentral: formData.get('fallbackToCentral') === 'on',
  })
  if (!parsed.success) return validationError(parsed.error)

  try {
    await setAppPolicy({
      ...parsed.data,
      actorId: user.id,
      correlationId: randomUUID(),
      reason: 'Updated alert policy',
    })
  } catch {
    return { status: 'error', message: 'Alert policy was not updated' }
  }
  revalidatePath('/apps')
  return { status: 'success', message: 'Alert policy updated' }
}

function validationError(error: z.ZodError): ActionState {
  return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: error.flatten().fieldErrors }
}
