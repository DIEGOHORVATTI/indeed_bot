import { useState } from 'react'
import { API_URL } from '@/lib/api'

export function PipelineControls() {
  const [loading, setLoading] = useState(false)

  async function handleAction(action: 'start' | 'stop') {
    setLoading(true)
    try {
      await fetch(`${API_URL}/api/pipeline/${action}`, { method: 'POST' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-card rounded-lg p-4 border border-border/50">
      <h3 className="text-sm font-semibold text-foreground mb-3">Pipeline</h3>
      <div className="flex gap-2">
        <button
          onClick={() => handleAction('start')}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded bg-success-dark hover:bg-success text-white disabled:opacity-50"
        >
          Iniciar
        </button>
        <button
          onClick={() => handleAction('stop')}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium rounded bg-error-dark hover:bg-error text-white disabled:opacity-50"
        >
          Parar
        </button>
      </div>
    </div>
  )
}
