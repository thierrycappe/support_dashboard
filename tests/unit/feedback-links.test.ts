import { describe, expect, it } from 'vitest'
import {
  getSourceAppPublicUrl,
  normalizeSourceTicketUrl,
} from '@/lib/feedback/links'

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
        'https://pitchme-pearl.vercel.app',
      ),
    ).toBe('https://pitchme-pearl.vercel.app/admin/bugs/bug-1?tab=details#comments')
  })

  it('drops localhost ticket URLs when there is no public base URL', () => {
    expect(
      normalizeSourceTicketUrl('http://127.0.0.1:3000/admin/bugs/bug-1', null),
    ).toBeNull()
  })

  it('rewrites Pitchme localhost ticket URLs with the built-in public fallback', () => {
    expect(
      normalizeSourceTicketUrl(
        'http://localhost:3000/admin/feedback/bug-1',
        'http://localhost:3000',
        'pitchme',
      ),
    ).toBe('https://pitchme-pearl.vercel.app/admin/feedback/bug-1')
  })

  it('uses configured source app URL overrides before stored app base URLs', () => {
    expect(
      getSourceAppPublicUrl(
        'pitchme',
        'http://localhost:3000',
        {
          SUPPORT_TOWER_SOURCE_APP_URLS_JSON: JSON.stringify({
            pitchme: 'https://pitchme-preview.vercel.app/',
          }),
        },
      ),
    ).toBe('https://pitchme-preview.vercel.app')
  })
})
