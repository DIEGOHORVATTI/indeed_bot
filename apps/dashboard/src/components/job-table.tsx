import { useState, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { fetcher, API_URL } from '@/lib/api'
import { STATUS_LABELS } from '@/lib/status-labels'
import { Link } from 'react-router-dom'

const STATUS_BADGE: Record<string, string> = {
  discovered: 'bg-secondary text-muted-foreground',
  enriched: 'bg-info/10 text-[#61F3F3]',
  scored: 'bg-[#8E33FF]/10 text-[#C684FF]',
  tailored: 'bg-[#8E33FF]/20 text-[#EFD6FF]',
  ready: 'bg-warning/10 text-[#FFD666]',
  applied: 'bg-success/10 text-[#77ED8B]',
  failed: 'bg-error/10 text-[#FFAC82]',
  skipped: 'bg-muted text-muted-foreground',
}

type Job = Record<string, unknown>

export function JobTable() {
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)

  const url = statusFilter
    ? `${API_URL}/api/jobs?status=${statusFilter}&limit=200`
    : `${API_URL}/api/jobs?limit=200`
  const { data: jobs, mutate } = useSWR<Job[]>(url, fetcher, { refreshInterval: 5000 })

  const jobList = useMemo(() => jobs ?? [], [jobs])
  const allIds = useMemo(() => jobList.map((j) => Number(j.id)), [jobList])
  const allSelected = jobList.length > 0 && selected.size === jobList.length

  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    )
  }, [allIds])

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    const label = ids.length === 1 ? '1 vaga' : `${ids.length} vagas`
    if (!confirm(`Excluir ${label}?`)) return

    setDeleting(true)
    try {
      await fetch(`${API_URL}/api/jobs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      setSelected(new Set())
      mutate()
    } finally {
      setDeleting(false)
    }
  }, [selected, mutate])

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {['', 'discovered', 'enriched', 'scored', 'tailored', 'ready', 'applied', 'failed', 'skipped'].map(
          (s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setSelected(new Set()) }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {s ? (STATUS_LABELS[s] || s) : 'Todos'}
            </button>
          )
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-error/10 border border-error/30 rounded-lg px-4 py-2">
          <span className="text-sm text-foreground">
            {selected.size === 1 ? '1 vaga selecionada' : `${selected.size} vagas selecionadas`}
          </span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="ml-auto px-3 py-1 rounded text-xs font-medium bg-error text-white hover:bg-error/80 disabled:opacity-50 transition-colors"
          >
            {deleting ? 'Excluindo...' : 'Excluir selecionadas'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1 rounded text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      <div className="bg-card rounded-lg overflow-hidden border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-left">
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-border accent-accent cursor-pointer"
                />
              </th>
              <th className="p-3">Titulo</th>
              <th className="p-3">Empresa</th>
              <th className="p-3">Pontuacao</th>
              <th className="p-3">Situacao</th>
              <th className="p-3">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {jobList.map((job) => {
              const id = Number(job.id)
              const isSelected = selected.has(id)
              return (
                <tr
                  key={id}
                  className={`border-b border-border/30 transition-colors ${
                    isSelected ? 'bg-accent/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(id)}
                      className="rounded border-border accent-accent cursor-pointer"
                    />
                  </td>
                  <td className="p-3">
                    <Link to={`/jobs/${job.id}`} className="text-accent hover:text-accent/80 hover:underline">
                      {String(job.title || 'Sem titulo')}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{String(job.company || '—')}</td>
                  <td className="p-3 font-mono text-foreground">{job.score != null ? String(job.score) : '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGE[String(job.status)] || ''}`}>
                      {STATUS_LABELS[String(job.status)] || String(job.status)}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">{String(job.updatedAt || '')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {jobList.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">Nenhuma vaga encontrada</div>
        )}
      </div>
    </div>
  )
}
