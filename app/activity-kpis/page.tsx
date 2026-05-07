import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  Clock3,
  Hourglass,
} from 'lucide-react'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { auth } from '@/auth'
import { getActivityKpisData } from '@/lib/feedback/activity'

export const dynamic = 'force-dynamic'

function customStyle(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties
}

function trendFromDelta(delta: string): 'up' | 'down' {
  return delta.trim().startsWith('-') ? 'down' : 'up'
}

export default async function ActivityKpisPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const data = await getActivityKpisData()

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Historical activity dashboard</p>
          <h1>Resolution runway</h1>
          <p className="subtle">
            Track bug resolution throughput, cycle time, requester wait, and current
            workflow drag.
          </p>
        </div>
        <span className="badge">Last 8 weeks · {data.periodLabel}</span>
      </div>

      {!data.databaseConfigured && (
        <div className="setup-box">
          <strong>Database not configured.</strong> Add `DATABASE_URL` to
          `.env.local`, run `npm run db:push`, then refresh this page.
        </div>
      )}

      <section className="mockup-board" id="resolution">
        <div className="mockup-heading">
          <div>
            <p className="eyebrow">Chosen dashboard</p>
            <h2>Resolution runway</h2>
          </div>
          <span className="badge">Live ticket data</span>
        </div>

        <div className="insight-grid">
          <MetricCard
            icon={<CheckCircle2 size={18} />}
            label="Resolved bugs"
            value={data.summary.resolvedBugs}
            delta={data.summary.resolvedDelta}
            trend={trendFromDelta(data.summary.resolvedDelta)}
          />
          <MetricCard
            icon={<Clock3 size={18} />}
            label="Median cycle"
            value={data.summary.medianCycle}
            delta={data.summary.medianCycleDelta}
            trend={trendFromDelta(data.summary.medianCycleDelta)}
          />
          <MetricCard
            icon={<Hourglass size={18} />}
            label="Requester wait"
            value={data.summary.requesterWait}
            delta={data.summary.requesterWaitDelta}
            trend={trendFromDelta(data.summary.requesterWaitDelta)}
          />
          <MetricCard
            icon={<Bug size={18} />}
            label="Created/resolved"
            value={data.summary.createdResolved}
            delta={data.summary.createdResolvedDelta}
            trend={trendFromDelta(data.summary.createdResolved)}
          />
        </div>

        <div className="mockup-layout mockup-layout-wide">
          <div className="panel chart-panel">
            <div className="panel-header chart-header">
              <h3>Created vs resolved</h3>
              <div className="chart-legend">
                <span>
                  <i className="legend-dot created-dot" /> Created
                </span>
                <span>
                  <i className="legend-dot resolved-dot" /> Resolved
                </span>
              </div>
            </div>
            <div className="panel-body">
              <div className="bar-chart">
                {data.throughputWeeks.map((week) => (
                  <div className="bar-week" key={week.label}>
                    <div className="bar-pair">
                      <span
                        className={`bar created-bar ${week.created === 0 ? 'bar-zero' : ''}`}
                        title={`${week.created} bugs created`}
                        style={customStyle({ '--height': `${week.createdHeight}%` })}
                      />
                      <span
                        className={`bar resolved-bar ${week.resolved === 0 ? 'bar-zero' : ''}`}
                        title={`${week.resolved} bugs resolved`}
                        style={customStyle({ '--height': `${week.resolvedHeight}%` })}
                      />
                    </div>
                    <span>{week.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel chart-panel">
            <div className="panel-header">
              <h3>Cycle-time outliers</h3>
            </div>
            <div className="panel-body">
              {data.cyclePoints.length > 0 ? (
                <div className="scatter-plot">
                  {data.cyclePoints.map((point) => (
                    <span
                      className="scatter-point"
                      key={point.id}
                      title={`${point.title} · ${point.appName} · ${point.days.toFixed(1)}d`}
                      style={customStyle({ '--x': `${point.x}%`, '--y': `${point.y}%` })}
                    />
                  ))}
                  <span className="axis-label axis-label-x">Tickets closed</span>
                  <span className="axis-label axis-label-y">Days</span>
                </div>
              ) : (
                <div className="empty-chart">No resolved bugs in this period.</div>
              )}
            </div>
          </div>

          <div className="panel chart-panel">
            <div className="panel-header">
              <h3>Time in status</h3>
            </div>
            <div className="panel-body status-bars">
              {data.statusTimes.length > 0 ? (
                data.statusTimes.map((item) => (
                  <div className="status-row" key={item.label}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.time}</span>
                    </div>
                    <i style={customStyle({ '--width': `${item.value}%` })} />
                  </div>
                ))
              ) : (
                <div className="empty-chart">No open bug workflow time yet.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  )
}

function MetricCard({
  icon,
  label,
  value,
  delta,
  trend,
}: {
  icon: ReactNode
  label: string
  value: string
  delta: string
  trend: 'up' | 'down'
}) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : ArrowDownRight

  return (
    <div className="panel metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <em className={trend === 'up' ? 'trend-up' : 'trend-down'}>
        <TrendIcon size={14} aria-hidden="true" />
        {delta}
      </em>
    </div>
  )
}
