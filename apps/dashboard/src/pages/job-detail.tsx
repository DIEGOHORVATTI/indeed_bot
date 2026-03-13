import useSWR from 'swr'
import { useParams } from 'react-router-dom'
import { fetcher, API_URL } from '@/lib/api'

export default function JobDetailPage() {
  const { id } = useParams()
  const { data: job, error } = useSWR(`${API_URL}/api/jobs/${id}`, fetcher)

  if (error) return <div className="text-error">Falha ao carregar vaga</div>
  if (!job) return <div className="text-muted-foreground">Carregando...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold">{job.title || 'Sem título'}</h2>
        <p className="text-muted-foreground">{job.company} — {job.location}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-lg p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Situação</h3>
          <span className="px-2 py-1 rounded text-xs font-medium bg-info/10 text-[#61F3F3]">
            {job.status}
          </span>
        </div>
        <div className="bg-card rounded-lg p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Pontuação</h3>
          <span className="text-2xl font-bold">{job.score ?? '—'}</span>
          {job.scoreReason && <p className="text-xs text-muted-foreground mt-1">{job.scoreReason}</p>}
        </div>
      </div>

      {job.description && (
        <div className="bg-card rounded-lg p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Descrição</h3>
          <p className="text-sm text-secondary-foreground whitespace-pre-wrap">{job.description}</p>
        </div>
      )}

      {job.tailoredCv && (
        <div className="bg-card rounded-lg p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">Dados do CV Personalizado</h3>
          <pre className="text-xs text-muted-foreground overflow-auto max-h-96">
            {JSON.stringify(JSON.parse(job.tailoredCv), null, 2)}
          </pre>
        </div>
      )}

      {(job.cvPdfPath || job.coverPdfPath) && (
        <div className="bg-card rounded-lg p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">PDFs</h3>
          <div className="flex gap-4">
            {job.cvPdfPath && (
              <a href={`${API_URL}/api/pdf/${job.cvPdfPath.split('/').pop()}`}
                 className="text-accent hover:underline text-sm" target="_blank">
                Baixar CV
              </a>
            )}
            {job.coverPdfPath && (
              <a href={`${API_URL}/api/pdf/${job.coverPdfPath.split('/').pop()}`}
                 className="text-accent hover:underline text-sm" target="_blank">
                Baixar Carta de Apresentação
              </a>
            )}
          </div>
        </div>
      )}

      {job.failReason && (
        <div className="bg-error/10 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-error mb-2">Motivo da Falha</h3>
          <p className="text-sm text-error-light">{job.failReason}</p>
        </div>
      )}
    </div>
  )
}
