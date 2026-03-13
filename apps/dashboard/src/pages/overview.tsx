import { StatsCards } from '@/components/stats-cards'
import { PipelineControls } from '@/components/pipeline-controls'
import { QueueMonitor } from '@/components/queue-monitor'

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Visão Geral</h2>
      <StatsCards />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PipelineControls />
        <QueueMonitor />
      </div>
    </div>
  )
}
