'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/guards'
import { setAppPolicy } from '@/lib/routing/policies'
import { createApplicationEnrollment } from '@/lib/apps/queries'

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> }

export type EnrollmentActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string[]> }
  | { status: 'created'; appId: string; invitationId: string; invitationSecret: string; expiresAt: string }

const policySchema = z.object({
  sourceAppId: z.string().trim().min(1, 'An application is required'),
  technicalGroupId: z.string().trim().transform((value) => value || null),
  minimumPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  urgentCentralCopy: z.boolean(),
  fallbackToCentral: z.boolean(),
})

const enrollmentSchema = z.object({
  name: z.string().trim().min(1, 'Enter an application name, then continue.').max(160),
  slug: z.string().trim().min(1, 'Enter a stable slug, then continue.').max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens.'),
  baseUrl: z.string().trim().url('Enter a complete application URL.').refine((value) => new URL(value).protocol === 'https:', 'Use an HTTPS application URL.'),
  environment: z.string().trim().min(1, 'Select an environment.').max(80),
  ownerIds: z.array(z.string().trim().min(1)).min(1, 'Select at least one owner, then continue.'),
  minimumPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  urgentCentralCopy: z.boolean(), fallbackToCentral: z.boolean(),
})

export async function createEnrollmentAction(_previous: EnrollmentActionState, formData: FormData): Promise<EnrollmentActionState> {
  const user = await requireAdminUser()
  const parsed = enrollmentSchema.safeParse({
    name: formData.get('name'), slug: formData.get('slug'), baseUrl: formData.get('baseUrl'),
    environment: formData.get('environment'), ownerIds: formData.getAll('ownerIds'),
    minimumPriority: formData.get('minimumPriority'), urgentCentralCopy: formData.get('urgentCentralCopy') === 'on',
    fallbackToCentral: formData.get('fallbackToCentral') === 'on',
  })
  if (!parsed.success) return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: parsed.error.flatten().fieldErrors }
  try {
    const result = await createApplicationEnrollment({ ...parsed.data, actorId: user.id, correlationId: randomUUID() })
    revalidatePath('/apps'); revalidatePath(`/apps/${result.appId}`)
    return { status: 'created', appId: result.appId, invitationId: result.invitation.id, invitationSecret: result.invitation.secret, expiresAt: result.invitation.expiresAt.toISOString() }
  } catch {
    return { status: 'error', message: 'Application enrollment was not created. Review the details and try again.', fieldErrors: {} }
  }
}

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
