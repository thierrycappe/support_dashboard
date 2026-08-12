import { sql } from 'drizzle-orm'
import { getDb, type Db } from '@/lib/db'
import { validateEd25519PublicJwk, type Ed25519PublicJwk } from '@/lib/service-auth/jwk'

export interface ActiveCredential {
  id: string
  sourceAppId: string
  publicJwk: Ed25519PublicJwk
}

export async function getActiveCredential({
  db = getDb(),
  credentialId,
  now = new Date(),
}: {
  db?: Db
  credentialId: string
  now?: Date
}): Promise<ActiveCredential | null> {
  const result = await db.execute<{
    id: string
    sourceAppId: string
    publicJwk: unknown
  } & Record<string, unknown>>(sql`
    select credential.id, credential.source_app_id as "sourceAppId", credential.public_jwk as "publicJwk"
      from app_credentials credential
      join source_apps app on app.id = credential.source_app_id
     where credential.id = ${credentialId}
       and credential.status = 'ACTIVE'
       and credential.revoked_at is null
       and credential.valid_from <= ${now}
       and (credential.valid_until is null or credential.valid_until > ${now})
       and app.status = 'ACTIVE'
       and app.enrollment_status = 'ACTIVE'
       and app.credential_mode = 'PUBLIC_KEY'
     limit 1
  `)
  const credential = result.rows[0]
  if (!credential) return null
  try {
    return { id: credential.id, sourceAppId: credential.sourceAppId, publicJwk: validateEd25519PublicJwk(credential.publicJwk) }
  } catch {
    return null
  }
}
