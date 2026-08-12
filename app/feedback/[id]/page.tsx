import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import AppShell from '@/components/AppShell'
import EscalationDetailContent from '@/components/escalations/EscalationDetailContent'
import { getDb, hasDatabaseUrl } from '@/lib/db'
import { getEscalationDetail } from '@/lib/escalations/detail'
import { getSourceAppPullConfig } from '@/lib/feedback/source-pull'

export const dynamic = 'force-dynamic'

export default async function FeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!hasDatabaseUrl()) {
    return <AppShell><div className="setup-box">Data is temporarily unavailable. Configure the application data connection, then reload this escalation.</div></AppShell>
  }

  const { id } = await params
  const detail = await getEscalationDetail(id, getDb())
  if (!detail) notFound()

  return (
    <AppShell>
      <EscalationDetailContent detail={{ ...detail, pullConfigured: Boolean(getSourceAppPullConfig(detail.application.slug)) }} />
    </AppShell>
  )
}
