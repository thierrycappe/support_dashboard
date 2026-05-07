import { describe, expect, it } from 'vitest'
import { normalizeSourceTicketUrl } from '@/lib/feedback/links'

describe('feedback link helpers', () => {
  it('keeps public source ticket URLs unchanged', () => {
    expect(
      normalizeSourceTicketUrl(
        'https://pitchme.example.com/admin/bugs/bug-1?tab=details',
        'https://pitchme.example.com',
      ),
    ).toBe('https://pitchme.example.com/admin/bugs/bug-1?tab=details')
  })

  it('rewrites localhost ticket URLs against the source app public base URL', () => {
    expect(
      normalizeSourceTicketUrl(
        'http://localhost:3000/admin/bugs/bug-1?tab=details#comments',
        'https://pitchme.vercel.app',
      ),
    ).toBe('https://pitchme.vercel.app/admin/bugs/bug-1?tab=details#comments')
  })

  it('drops localhost ticket URLs when there is no public base URL', () => {
    expect(normalizeSourceTicketUrl('http://127.0.0.1:3000/admin/bugs/bug-1', null)).toBeNull()
  })
})
