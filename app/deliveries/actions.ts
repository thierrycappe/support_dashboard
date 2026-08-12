'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/guards'
import { retryFailedDelivery } from '@/lib/delivery/repository'
import { scheduleDeliveryWakeup } from '@/lib/delivery/worker'

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> }

const deliverySchema = z.object({
  deliveryId: z.string().trim().min(1, 'A delivery is required'),
})

export async function retryDeliveryAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser()
  const parsed = deliverySchema.safeParse({ deliveryId: String(formData.get('deliveryId') ?? '') })
  if (!parsed.success) return validationError(parsed.error)

  try {
    await retryFailedDelivery({
      id: parsed.data.deliveryId,
      actorId: user.id,
      correlationId: randomUUID(),
      reason: 'Retried failed delivery',
    })
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Delivery was not queued' }
  }
  scheduleDeliveryWakeup()
  revalidatePath('/deliveries')
  return { status: 'success', message: 'Delivery queued' }
}

function validationError(error: z.ZodError): ActionState {
  return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: error.flatten().fieldErrors }
}
