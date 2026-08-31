import { permanentRedirect } from 'next/navigation'
import type { Route } from 'next'

export default function ActivityKpisPage() {
  permanentRedirect('/insights' as Route)
}
