'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireDeliveryRetryUser } from '@/lib/auth/guards'
import { DeliveryRetryError, retryFailedDelivery } from '@/lib/delivery/repository'
import { scheduleDeliveryWakeup } from '@/lib/delivery/worker'

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> }

const deliverySchema = z.object({
  deliveryId: z.string().trim().min(1, 'A delivery is required'),
})

export async function retryDeliveryAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireDeliveryRetryUser()
  const parsed = deliverySchema.safeParse({ deliveryId: String(formData.get('deliveryId') ?? '') })
  if (!parsed.success) return validationError(parsed.error)

  try {
    const result = await retryFailedDelivery({
      id: parsed.data.deliveryId,
      actorId: user.id,
      correlationId: randomUUID(),
      reason: 'Retried failed delivery',
    })
    scheduleDeliveryWakeup()
    revalidatePath('/deliveries')
    return { status: 'success', message: result.outcome === 'created' ? 'Delivery queued' : 'Delivery already queued' }
  } catch (error) {
    return { status: 'error', message: retryErrorMessage(error) }
  }
}

function validationError(error: z.ZodError): ActionState {
  return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: error.flatten().fieldErrors }
}

function retryErrorMessage(error: unknown): string {
  if (!(error instanceof DeliveryRetryError)) return 'Delivery could not be queued'
  if (error.code === 'NOT_FOUND') return 'Delivery is no longer available'
  if (error.code === 'NOT_ELIGIBLE') return 'Only failed deliveries can be retried'
  return 'Delivery retry is no longer pending'
}
