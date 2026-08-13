import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CredentialLifecycle from '@/components/apps/CredentialLifecycle'

const credentials = [
  { id: 'credential-current', status: 'ACTIVE', health: 'OVERLAP' as const, validFrom: '2026-08-13T09:00:00.000Z', validUntil: '2026-08-13T11:00:00.000Z', revokedAt: null, createdAt: '2026-08-13T09:00:00.000Z', parentCredentialId: null, thumbprint: 'old-thumbprint', canRotateFrom: true, canRevoke: true },
  { id: 'credential-next', status: 'ACTIVE', health: 'ACTIVE' as const, validFrom: '2026-08-13T10:00:00.000Z', validUntil: null, revokedAt: null, createdAt: '2026-08-13T09:55:00.000Z', parentCredentialId: 'credential-current', thumbprint: 'next-thumbprint', canRotateFrom: true, canRevoke: true },
  { id: 'credential-revoked', status: 'REVOKED', health: 'REVOKED' as const, validFrom: '2026-08-12T09:00:00.000Z', validUntil: '2026-08-12T11:00:00.000Z', revokedAt: '2026-08-12T11:00:00.000Z', createdAt: '2026-08-12T09:00:00.000Z', parentCredentialId: null, thumbprint: 'revoked-thumbprint', canRotateFrom: false, canRevoke: false },
]

describe('administrator credential lifecycle', () => {
  it('renders factual credential health and the safe assisted-rotation contract', () => {
    render(<CredentialLifecycle appId="app-1" credentials={credentials} beginAction={vi.fn()} revokeAction={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Credential health' })).toBeVisible()
    expect(screen.getByText('Overlap')).toBeVisible()
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getByText('Revoked')).toBeVisible()
    expect(screen.getByText(/private key stays in the connector/i)).toBeVisible()
    expect(screen.getByLabelText('Current active credential')).toHaveValue('credential-next')
    expect(screen.getByLabelText('New Ed25519 public JWK')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Begin key rotation' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Revoke credential credential-current' })).toBeVisible()
    expect(screen.queryByText(/private-key-material/)).toBeNull()
    expect(screen.getByText('Aug 13, 2026, 9:55 AM UTC')).toBeVisible()
  })

  it('reveals the challenge once, provides connector confirmation instructions, and clears it on pagehide', async () => {
    const beginAction = vi.fn().mockResolvedValue({
      status: 'created', credentialId: 'credential-new', challenge: 'one-time-confirmation-challenge',
      expiresAt: '2026-08-13T10:05:00.000Z',
    })
    render(<CredentialLifecycle appId="app-1" credentials={credentials} beginAction={beginAction} revokeAction={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('New Ed25519 public JWK'), { target: { value: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'public-x' }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Begin key rotation' }))

    expect(await screen.findByText('one-time-confirmation-challenge')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Confirm the new key' })).toBeVisible()
    expect(screen.getByText(/sign this challenge with the new private key/i)).toBeVisible()
    expect(screen.getByText(/existing connector proof endpoint/i)).toBeVisible()
    expect(screen.getByText(/shown only in this browser view/i)).toBeVisible()
    fireEvent(window, new PageTransitionEvent('pagehide', { persisted: true }))
    await waitFor(() => expect(screen.queryByText('one-time-confirmation-challenge')).toBeNull())
    expect(screen.getByText('Rotation challenge hidden')).toBeVisible()
  })

  it('submits revocation independently and reports its result next to the credential', async () => {
    const revokeAction = vi.fn().mockResolvedValue({ status: 'success', message: 'Credential revoked' })
    render(<CredentialLifecycle appId="app-1" credentials={credentials} beginAction={vi.fn()} revokeAction={revokeAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke credential credential-current' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Credential revoked')
    expect(revokeAction).toHaveBeenCalledOnce()
    const submitted = revokeAction.mock.calls[0]![1] as FormData
    expect(submitted.get('appId')).toBe('app-1')
    expect(submitted.get('credentialId')).toBe('credential-current')
  })

  it('stacks credential rows and one-time challenge actions at small widths', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.credential-row[\s\S]*?grid-template-columns:\s*1fr/)
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.credential-actions\s*\{[\s\S]*?flex-direction:\s*column/)
    expect(css).toMatch(/\.credential-actions \.ui-button\s*\{[\s\S]*?width:\s*100%/)
  })
})
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
