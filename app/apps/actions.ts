'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminUser } from '@/lib/auth/guards'
import { setAppPolicy } from '@/lib/routing/policies'
import { createApplicationEnrollment } from '@/lib/apps/queries'
import { applicationBaseUrlIssue } from '@/lib/apps/validation'
import { beginAdminCredentialRotation, revokeCredential } from '@/lib/service-auth/credentials'
import { validateEd25519PublicJwk } from '@/lib/service-auth/jwk'

export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> }

export type EnrollmentActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string[]> }
  | { status: 'created'; appId: string; invitationId: string; invitationSecret: string; expiresAt: string }

export type CredentialRotationActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors: Record<string, string[]> }
  | { status: 'created'; credentialId: string; challenge: string; expiresAt: string }

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
  baseUrl: z.string().trim().superRefine((value, context) => {
    const issue = applicationBaseUrlIssue(value)
    if (issue === 'INVALID_URL') context.addIssue({ code: 'custom', message: 'Enter a complete application URL.' })
    if (issue === 'HTTPS_REQUIRED') context.addIssue({ code: 'custom', message: 'Use an HTTPS application URL.' })
    if (issue === 'CREDENTIALS_FORBIDDEN') context.addIssue({ code: 'custom', message: 'Remove credentials from the application URL.' })
  }),
  environment: z.string().trim().min(1, 'Select an environment.').max(80),
  ownerIds: z.array(z.string().trim().min(1)).min(1, 'Select at least one owner, then continue.'),
  minimumPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  urgentCentralCopy: z.boolean(), fallbackToCentral: z.boolean(),
})

const credentialMutationSchema = z.object({
  appId: z.string().trim().min(1).max(200),
  credentialId: z.string().trim().min(1).max(200),
})

const rotationSchema = z.object({
  appId: z.string().trim().min(1, 'An application is required.').max(200),
  parentCredentialId: z.string().trim().min(1, 'Select a current active credential.').max(200),
  publicJwk: z.string().trim().min(1, 'Enter an Ed25519 public JWK.').max(4_096),
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
  let result: Awaited<ReturnType<typeof createApplicationEnrollment>>
  try {
    result = await createApplicationEnrollment({ ...parsed.data, actorId: user.id, correlationId: randomUUID() })
  } catch {
    return { status: 'error', message: 'Application enrollment was not created. Review the details and try again.', fieldErrors: {} }
  }
  try { revalidatePath('/apps') } catch { /* The committed invitation must still be returned. */ }
  try { revalidatePath(`/apps/${result.appId}`) } catch { /* Cache invalidation is best effort after commit. */ }
  return { status: 'created', appId: result.appId, invitationId: result.invitation.id, invitationSecret: result.invitation.secret, expiresAt: result.invitation.expiresAt.toISOString() }
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

export async function beginAdminRotationAction(
  _previous: CredentialRotationActionState,
  formData: FormData,
): Promise<CredentialRotationActionState> {
  const user = await requireAdminUser()
  const parsed = rotationSchema.safeParse({
    appId: String(formData.get('appId') ?? ''),
    parentCredentialId: String(formData.get('parentCredentialId') ?? ''),
    publicJwk: String(formData.get('publicJwk') ?? ''),
  })
  if (!parsed.success) {
    return { status: 'error', message: 'Review the rotation details and try again.', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  let publicJwk: unknown
  try {
    publicJwk = validateEd25519PublicJwk(JSON.parse(parsed.data.publicJwk))
  } catch {
    return {
      status: 'error', message: 'Review the rotation details and try again.',
      fieldErrors: { publicJwk: ['Enter a valid Ed25519 public JWK.'] },
    }
  }
  try {
    const result = await beginAdminCredentialRotation({
      appId: parsed.data.appId,
      parentCredentialId: parsed.data.parentCredentialId,
      nextPublicJwk: publicJwk,
      actorId: user.id,
      correlationId: randomUUID(),
    })
    try { revalidatePath(`/apps/${parsed.data.appId}`) } catch { /* The one-time challenge must survive cache invalidation failure. */ }
    return { status: 'created', credentialId: result.credentialId, challenge: result.challenge, expiresAt: result.expiresAt.toISOString() }
  } catch (error) {
    const code = rotationErrorCode(error)
    if (code === 'DUPLICATE_CREDENTIAL') return { status: 'error', message: 'This public key is already registered.', fieldErrors: {} }
    if (code === 'ROTATION_IN_PROGRESS') return { status: 'error', message: 'A key rotation is already awaiting connector confirmation.', fieldErrors: {} }
    if (code === 'CREDENTIAL_NOT_FOUND') return { status: 'error', message: 'The selected credential is no longer active. Refresh the page and try again.', fieldErrors: {} }
    return { status: 'error', message: 'Key rotation was not started. Check credential health and try again.', fieldErrors: {} }
  }
}

export async function revokeAppCredentialAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser()
  const parsed = credentialMutationSchema.safeParse({
    appId: String(formData.get('appId') ?? ''),
    credentialId: String(formData.get('credentialId') ?? ''),
  })
  if (!parsed.success) return { status: 'error', message: 'Credential was not revoked. Refresh the page and try again.' }
  try {
    await revokeCredential({
      appId: parsed.data.appId,
      credentialId: parsed.data.credentialId,
      actorId: user.id,
      actorType: 'USER',
      correlationId: randomUUID(),
    })
    try { revalidatePath(`/apps/${parsed.data.appId}`) } catch { /* Revocation is already durable. */ }
    return { status: 'success', message: 'Credential revoked' }
  } catch (error) {
    if (rotationErrorCode(error) === 'LAST_ACTIVE_CREDENTIAL') {
      return { status: 'error', message: 'This is the last active credential. Activate another credential before revoking it.' }
    }
    return { status: 'error', message: 'Credential was not revoked. Refresh the page and try again.' }
  }
}

function validationError(error: z.ZodError): ActionState {
  return { status: 'error', message: 'Please correct the highlighted fields', fieldErrors: error.flatten().fieldErrors }
}

function rotationErrorCode(error: unknown): string | null {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null
}
