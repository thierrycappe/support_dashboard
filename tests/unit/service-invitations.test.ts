import { describe, expect, it } from 'vitest'
import { invitationDigest, invitationDigestMatches } from '@/lib/service-auth/invitations'

describe('invitation secrets', () => {
  it('hashes arbitrary-length supplied secrets before constant-time comparison', () => {
    const digest = invitationDigest('correct-secret')

    expect(digest).toHaveLength(32)
    expect(invitationDigestMatches('correct-secret', digest.toString('hex'))).toBe(true)
    expect(invitationDigestMatches('wrong-secret', digest.toString('hex'))).toBe(false)
    expect(invitationDigestMatches('', digest.toString('hex'))).toBe(false)
    expect(invitationDigestMatches('correct-secret', 'short')).toBe(false)
  })
})
