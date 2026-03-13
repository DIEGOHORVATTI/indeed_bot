import useSWR from 'swr'
import { fetcher, API_URL } from '@/lib/api'

export function QueueMonitor() {
  const { data } = useSWR(`${API_URL}/api/pipeline/status`, fetcher, {
    refreshInterval: 3000,
  })

  if (!data) return <div className="bg-card rounded-lg p-4 text-muted-foreground border border-border/50">Carregando filas...</div>

  const stages = data.stages as Record<string, { waiting: number; active: number; completed: number; failed: number }>

  return (
    <div className="bg-card rounded-lg p-4 border border-border/50">
      <h3 className="text-lg font-semibold text-foreground mb-4">Status das Filas</h3>
      <div className="space-y-2">
        {Object.entries(stages).map(([name, counts]) => (
          <div key={name} className="flex items-center justify-between text-sm">
            <span className="font-medium capitalize w-24 text-card-foreground">{name}</span>
            <div className="flex gap-4 text-xs">
              <span className="text-warning">{counts.waiting} aguardando</span>
              <span className="text-info">{counts.active} ativo</span>
              <span className="text-success">{counts.completed} concluído</span>
              <span className="text-error">{counts.failed} falhou</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {data.isRunning ? '● Pipeline em execução' : '○ Pipeline inativo'}
      </div>
    </div>
  )
}
