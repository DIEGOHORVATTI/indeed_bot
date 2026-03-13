import useSWR from 'swr'
import { fetcher, API_URL } from '@/lib/api'
import { STATUS_LABELS } from '@/lib/status-labels'

const STATUS_COLORS: Record<string, string> = {
  discovered: 'bg-secondary',
  enriched: 'bg-info/10',
  scored: 'bg-[#8E33FF]/10',
  tailored: 'bg-[#8E33FF]/20',
  ready: 'bg-warning/10',
  applied: 'bg-success/10',
  failed: 'bg-error/10',
  skipped: 'bg-muted',
}

export function StatsCards() {
  const { data: stats } = useSWR(`${API_URL}/api/jobs/stats`, fetcher, {
    refreshInterval: 5000,
  })

  if (!stats) return <div className="text-muted-foreground">Carregando estatísticas...</div>

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
      {(stats as { status: string; count: number }[]).map((s) => (
        <div key={s.status} className={`${STATUS_COLORS[s.status] || 'bg-secondary'} rounded-lg p-3 border border-border/50`}>
          <div className="text-2xl font-bold text-foreground">{s.count}</div>
          <div className="text-xs text-muted-foreground">{STATUS_LABELS[s.status] || s.status}</div>
        </div>
      ))}
    </div>
  )
}
