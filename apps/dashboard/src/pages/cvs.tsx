import { useState, useEffect } from 'react'
import useSWR, { mutate } from 'swr'
import { API_URL, fetcher } from '@/lib/api'

interface CV {
  id: string
  name: string
  variant: string
  template: string
  score: number
  jobTitle?: string
  jobCompany?: string
  jobId?: string
  htmlContent?: string
  paletteId?: string
  createdAt: string
}

interface Job {
  id: string
  title: string
  company: string
}

const TEMPLATES = [
  { id: 'classic', name: 'Clássico', description: 'Layout limpo e profissional, foco em ATS' },
  { id: 'modern', name: 'Moderno', description: 'Design contemporâneo com sidebar de habilidades' },
  { id: 'minimal', name: 'Minimalista', description: 'Menos é mais — direto ao ponto' },
]

const VARIANTS = ['A', 'B', 'C', 'D', 'E']

const VARIANT_COLORS: Record<string, string> = {
  A: 'bg-info/10 text-[#61F3F3]',
  B: 'bg-[#8E33FF]/10 text-[#C684FF]',
  C: 'bg-warning/10 text-[#FFD666]',
  D: 'bg-success/10 text-[#77ED8B]',
  E: 'bg-error/10 text-[#FFAC82]',
}

const COLOR_PALETTES = [
  { id: 'profissional', name: 'Profissional', desc: 'Corporativo -- Financas, Direito, Saude', primary: '#1B2A4A', accent: '#2E5FA3', text: '#1A1A1A', bg: '#FFFFFF', muted: '#F0F4F8' },
  { id: 'executivo', name: 'Executivo', desc: 'C-suite, Consultoria, Investimentos', primary: '#2C2C2C', accent: '#B8962E', text: '#1A1A1A', bg: '#FFFFFF', muted: '#F5F5F0' },
  { id: 'moderno', name: 'Moderno', desc: 'Tech, Startups, UX, Marketing Digital', primary: '#1E3A3A', accent: '#2A9D8F', text: '#1A1A1A', bg: '#FFFFFF', muted: '#F0F7F6' },
  { id: 'classico', name: 'Classico', desc: 'ESG, Educacao, Saude, ONGs', primary: '#1A3A2A', accent: '#2D6A4F', text: '#1A1A1A', bg: '#FFFFFF', muted: '#F2F7F4' },
  { id: 'criativo', name: 'Criativo', desc: 'Marketing, Publicidade, Midia', primary: '#5C1A2E', accent: '#8B2E4A', text: '#1A1A1A', bg: '#FFFFFF', muted: '#F7F2F4' },
  { id: 'minimalista', name: 'Minimalista', desc: 'Academia, Engenharia, Juridico', primary: '#1A1A1A', accent: '#4A4A4A', text: '#1A1A1A', bg: '#FFFFFF', muted: '#F5F5F5' },
] as const

function swapPaletteColors(html: string, fromId: string, toId: string): string {
  if (fromId === toId) return html
  const from = COLOR_PALETTES.find(c => c.id === fromId) || COLOR_PALETTES[0]
  const to = COLOR_PALETTES.find(c => c.id === toId) || COLOR_PALETTES[0]
  const replace = (s: string, find: string, rep: string) => s.split(find).join(rep)
  const hexToRgb = (hex: string) =>
    `${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}`
  let result = html
  result = replace(result, from.primary.toLowerCase(), to.primary.toLowerCase())
  result = replace(result, from.primary.toUpperCase(), to.primary.toUpperCase())
  result = replace(result, from.accent.toLowerCase(), to.accent.toLowerCase())
  result = replace(result, from.accent.toUpperCase(), to.accent.toUpperCase())
  result = replace(result, `rgba(${hexToRgb(from.accent)},`, `rgba(${hexToRgb(to.accent)},`)
  return result
}

const inputClass =
  'w-full bg-background border border-input rounded px-3 py-2 text-sm text-card-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-ring'

function TemplatePreview({ templateId }: { templateId: string }) {
  if (templateId === 'classic') {
    return (
      <div className="w-full h-full bg-white rounded p-3 flex flex-col gap-1.5">
        <div className="h-3 w-20 bg-gray-800 rounded-sm" />
        <div className="h-1.5 w-28 bg-gray-300 rounded-sm" />
        <div className="mt-2 h-0.5 w-full bg-gray-200" />
        <div className="mt-1 space-y-1">
          <div className="h-2 w-16 bg-gray-700 rounded-sm" />
          <div className="h-1.5 w-full bg-gray-200 rounded-sm" />
          <div className="h-1.5 w-4/5 bg-gray-200 rounded-sm" />
          <div className="h-1.5 w-full bg-gray-200 rounded-sm" />
        </div>
        <div className="mt-2 space-y-1">
          <div className="h-2 w-20 bg-gray-700 rounded-sm" />
          <div className="h-1.5 w-full bg-gray-200 rounded-sm" />
          <div className="h-1.5 w-3/4 bg-gray-200 rounded-sm" />
        </div>
      </div>
    )
  }
  if (templateId === 'modern') {
    return (
      <div className="w-full h-full bg-white rounded flex overflow-hidden">
        <div className="w-1/3 bg-gray-800 p-2 flex flex-col gap-1.5">
          <div className="h-8 w-8 rounded-full bg-gray-600 mx-auto" />
          <div className="h-1.5 w-full bg-gray-600 rounded-sm" />
          <div className="mt-2 space-y-1">
            <div className="h-1.5 w-3/4 bg-gray-500 rounded-sm" />
            <div className="h-1.5 w-full bg-gray-500 rounded-sm" />
            <div className="h-1.5 w-2/3 bg-gray-500 rounded-sm" />
          </div>
        </div>
        <div className="flex-1 p-2 flex flex-col gap-1.5">
          <div className="h-3 w-20 bg-gray-800 rounded-sm" />
          <div className="h-1.5 w-full bg-gray-200 rounded-sm" />
          <div className="h-1.5 w-4/5 bg-gray-200 rounded-sm" />
          <div className="mt-1 h-2 w-16 bg-gray-700 rounded-sm" />
          <div className="h-1.5 w-full bg-gray-200 rounded-sm" />
          <div className="h-1.5 w-3/4 bg-gray-200 rounded-sm" />
        </div>
      </div>
    )
  }
  return (
    <div className="w-full h-full bg-white rounded p-4 flex flex-col gap-2">
      <div className="h-4 w-24 bg-gray-900 rounded-sm" />
      <div className="h-1 w-16 bg-gray-300 rounded-sm" />
      <div className="mt-3 space-y-2">
        <div className="h-1.5 w-full bg-gray-200 rounded-sm" />
        <div className="h-1.5 w-3/5 bg-gray-200 rounded-sm" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-1.5 w-full bg-gray-200 rounded-sm" />
        <div className="h-1.5 w-4/5 bg-gray-200 rounded-sm" />
      </div>
    </div>
  )
}

export default function CvsPage() {
  const { data: cvs, mutate: mutateCvs } = useSWR<CV[]>(`${API_URL}/api/cvs`, fetcher)
  const { data: jobs } = useSWR<Job[]>(`${API_URL}/api/jobs`, fetcher)

  const [showGenModal, setShowGenModal] = useState(false)
  const [previewCvId, setPreviewCvId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')

  const [formName, setFormName] = useState('')
  const [formVariant, setFormVariant] = useState('A')
  const [formTemplate, setFormTemplate] = useState('classic')
  const [formJobDesc, setFormJobDesc] = useState('')
  const [formJobId, setFormJobId] = useState('')
  const [formPalette, setFormPalette] = useState('profissional')
  const [formExtraInstructions, setFormExtraInstructions] = useState('')
  const [previewPalette, setPreviewPalette] = useState('')
  const [previewTemplate, setPreviewTemplate] = useState('')
  const [savingPreview, setSavingPreview] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const { data: previewCv } = useSWR<CV>(
    previewCvId ? `${API_URL}/api/cvs/${previewCvId}` : null,
    fetcher,
  )

  const nextVariantName = () => {
    const existing = new Set((cvs ?? []).map((c: CV) => c.name))
    for (const v of VARIANTS) {
      const name = `Variante ${v}`
      if (!existing.has(name)) return { name, variant: v }
    }
    return { name: `Variante ${VARIANTS.length + 1}`, variant: VARIANTS[0] }
  }

  const openGenModal = async (templateId?: string) => {
    const next = nextVariantName()
    setFormName(next.name)
    setFormVariant(next.variant)
    setFormTemplate(templateId || 'classic')
    setFormJobDesc('')
    setFormJobId('')
    setFormPalette('profissional')
    setFormExtraInstructions('')
    setGenError('')
    setShowGenModal(true)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setGenError('')
    try {
      const res = await fetch(`${API_URL}/api/cvs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          variant: formVariant,
          template: formTemplate,
          paletteId: formPalette,
          jobDescription: formJobDesc,
          jobId: formJobId || undefined,
          extraInstructions: formExtraInstructions || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Erro ao gerar CV' }))
        throw new Error(err.message || 'Erro ao gerar CV')
      }
      setShowGenModal(false)
      mutate(`${API_URL}/api/cvs`)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setGenerating(false)
    }
  }

  const handleScore = async (id: string) => {
    await fetch(`${API_URL}/api/cvs/${id}/score`, { method: 'POST' })
    mutate(`${API_URL}/api/cvs`)
    if (previewCvId === id) mutate(`${API_URL}/api/cvs/${id}`)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este currículo?')) return
    await fetch(`${API_URL}/api/cvs/${id}`, { method: 'DELETE' })
    mutate(`${API_URL}/api/cvs`)
    if (previewCvId === id) setPreviewCvId(null)
  }

  const handleJobSelect = (jobId: string) => {
    setFormJobId(jobId)
    if (jobId && jobs) {
      const job = jobs.find((j: Job) => j.id === jobId)
      if (job && !formName) {
        setFormName(`CV para ${job.title} — Variante ${formVariant}`)
      }
    }
  }

  useEffect(() => {
    if (previewCv) {
      setPreviewPalette(previewCv.paletteId || 'profissional')
      setPreviewTemplate(previewCv.template || 'classic')
    }
  }, [previewCv?.id])

  const handleSavePreview = async () => {
    if (!previewCvId) return
    setSavingPreview(true)
    try {
      await fetch(`${API_URL}/api/cvs/${previewCvId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paletteId: previewPalette, templateId: previewTemplate }),
      })
      mutate(`${API_URL}/api/cvs`)
      mutate(`${API_URL}/api/cvs/${previewCvId}`)
    } catch {}
    setSavingPreview(false)
  }

  const handleDownload = async () => {
    if (!previewHtml || !previewCv) return
    setDownloading(true)
    try {
      const res = await fetch(`${API_URL}/api/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: previewHtml, filename: `${previewCv.name}.pdf` }),
      })
      if (!res.ok) throw new Error('Falha ao gerar PDF')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${previewCv.name}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
    } finally {
      setDownloading(false)
    }
  }

  const previewHtml = previewCv?.htmlContent
    ? swapPaletteColors(
        previewCv.htmlContent,
        previewCv.paletteId || 'profissional',
        previewPalette || previewCv.paletteId || 'profissional',
      )
    : ''

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Currículos</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Gerador de CV com teste A/B — acompanhe qual versão performa melhor
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => mutateCvs()}
            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 rounded text-xs font-medium text-secondary-foreground transition-colors"
          >
            Atualizar
          </button>
          <button
            onClick={() => openGenModal()}
            className="px-4 py-1.5 bg-accent hover:bg-accent/80 rounded text-xs font-medium text-accent-foreground transition-colors"
          >
            Gerar Novo CV
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-card-foreground mb-3">Templates</h3>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="flex-shrink-0 w-[200px] bg-card rounded-lg border border-border/50 overflow-hidden"
            >
              <div className="h-[180px] p-2 bg-secondary/50">
                <TemplatePreview templateId={t.id} />
              </div>
              <div className="p-3 space-y-1.5">
                <span className="text-sm font-semibold text-card-foreground">{t.name}</span>
                <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
                <button
                  onClick={() => openGenModal(t.id)}
                  className="mt-1 px-3 py-1 bg-accent hover:bg-accent/80 rounded text-xs font-medium text-accent-foreground transition-colors"
                >
                  Usar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!cvs ? (
        <div className="text-muted-foreground text-sm">Carregando currículos...</div>
      ) : cvs.length === 0 ? (
        <div className="bg-card rounded-lg p-8 text-center border border-border/50">
          <p className="text-muted-foreground text-sm">
            Nenhum currículo gerado ainda. Clique em &apos;Gerar Novo CV&apos; para começar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cvs.map((cv: CV) => (
            <div key={cv.id} className="bg-card rounded-lg p-5 border border-border/50 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{cv.name}</span>
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded ${VARIANT_COLORS[cv.variant] || 'bg-muted text-muted-foreground'}`}
                  >
                    {cv.variant}
                  </span>
                </div>
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${cv.score > 0 ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}
                >
                  <span className="text-lg font-bold">{cv.score}</span>
                  <button
                    onClick={() => handleScore(cv.id)}
                    className="text-xs font-bold hover:opacity-70 transition-opacity"
                    title="Incrementar score"
                  >
                    +1
                  </button>
                </div>
              </div>

              {cv.jobTitle && (
                <p className="text-xs text-muted-foreground">
                  Para: {cv.jobTitle}
                  {cv.jobCompany ? ` @ ${cv.jobCompany}` : ''}
                </p>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {new Date(cv.createdAt).toLocaleDateString('pt-BR')}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPreviewCvId(cv.id)}
                    className="px-3 py-1 bg-secondary hover:bg-muted rounded text-xs font-medium text-secondary-foreground transition-colors"
                  >
                    Visualizar
                  </button>
                  <button
                    onClick={() => handleDelete(cv.id)}
                    className="px-3 py-1 bg-error/10 hover:bg-error/20 rounded text-xs font-medium text-error transition-colors"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showGenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-border/50">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-foreground">Gerar Novo CV</h3>
              <button
                onClick={() => setShowGenModal(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nome do CV</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="CV para Vaga X — Variante A"
                  className={`${inputClass} placeholder:text-muted-foreground/50`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Variante</label>
                  <select
                    value={formVariant}
                    onChange={(e) => setFormVariant(e.target.value)}
                    className={inputClass}
                  >
                    {VARIANTS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Template</label>
                  <select
                    value={formTemplate}
                    onChange={(e) => setFormTemplate(e.target.value)}
                    className={inputClass}
                  >
                    {TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Paleta de Cores</label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {COLOR_PALETTES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFormPalette(p.id)}
                      className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                        formPalette === p.id
                          ? 'border-accent bg-accent/10 ring-1 ring-accent'
                          : 'border-border/50 bg-secondary/30 hover:bg-secondary/60'
                      }`}
                    >
                      <div className="relative w-6 h-6 flex-shrink-0">
                        <div
                          className="w-6 h-6 rounded-full"
                          style={{ backgroundColor: p.primary }}
                        />
                        <div
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card"
                          style={{ backgroundColor: p.accent }}
                        />
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-medium text-card-foreground leading-tight">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground leading-tight">{p.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Instrucoes adicionais <span className="text-muted-foreground/50">(opcional)</span>
                </label>
                <textarea
                  value={formExtraInstructions}
                  onChange={(e) => setFormExtraInstructions(e.target.value)}
                  placeholder="Ex: Tenho disponibilidade imediata, mencionar experiencia com Kubernetes, destacar lideranca de equipes remotas..."
                  className={`${inputClass} placeholder:text-muted-foreground/50 min-h-[80px] resize-y`}
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Descrição da Vaga <span className="text-muted-foreground/50">(opcional)</span>
                </label>
                <textarea
                  value={formJobDesc}
                  onChange={(e) => setFormJobDesc(e.target.value)}
                  placeholder="Cole a descrição completa da vaga alvo..."
                  className={`${inputClass} placeholder:text-muted-foreground/50 min-h-[200px] resize-y`}
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Vaga vinculada <span className="text-muted-foreground/50">(opcional)</span>
                </label>
                <select
                  value={formJobId}
                  onChange={(e) => handleJobSelect(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Nenhuma</option>
                  {jobs?.map((j: Job) => (
                    <option key={j.id} value={j.id}>
                      {j.title} — {j.company}
                    </option>
                  ))}
                </select>
              </div>

              {genError && (
                <p className="text-xs text-error bg-error/10 rounded px-3 py-2">{genError}</p>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-2 bg-accent hover:bg-accent/80 rounded text-sm font-medium text-accent-foreground disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                    Gerando currículo com IA...
                  </>
                ) : (
                  'Gerar CV com IA'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewCvId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col border border-border/50 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-foreground">
                  {previewCv?.name || 'Carregando...'}
                </h3>
                {previewCv?.variant && (
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded ${VARIANT_COLORS[previewCv.variant] || 'bg-muted text-muted-foreground'}`}
                  >
                    {previewCv.variant}
                  </span>
                )}
                {previewCv && (
                  <span
                    className={`px-2 py-0.5 text-xs font-bold rounded ${previewCv.score > 0 ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}
                  >
                    Score: {previewCv.score}
                  </span>
                )}
              </div>
              <button
                onClick={() => setPreviewCvId(null)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="flex items-center gap-4 mx-6 mb-4 p-3 bg-secondary/30 rounded-lg border border-border/50 shadow-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">Paleta:</span>
                {COLOR_PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreviewPalette(p.id)}
                    title={p.name}
                    className={`relative w-6 h-6 rounded-full transition-all ${
                      previewPalette === p.id ? 'ring-2 ring-accent ring-offset-1 ring-offset-card scale-110' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: p.primary }}
                  >
                    <span
                      className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-white"
                      style={{ backgroundColor: p.accent }}
                    />
                  </button>
                ))}
              </div>

              <div className="h-5 w-px bg-border/50" />

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Template:</span>
                <select
                  value={previewTemplate}
                  onChange={(e) => setPreviewTemplate(e.target.value)}
                  className="bg-background border border-input rounded px-2 py-1 text-xs text-card-foreground focus:outline-none focus:border-accent"
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleSavePreview}
                disabled={savingPreview}
                className="ml-auto px-3 py-1.5 bg-accent hover:bg-accent/80 rounded text-xs font-medium text-accent-foreground disabled:opacity-50 transition-colors"
              >
                {savingPreview ? 'Salvando...' : 'Salvar alteracoes'}
              </button>
            </div>

            <div className="flex-1 min-h-0 mx-6 mb-0">
              {previewCv?.htmlContent ? (
                <div className="h-full rounded-lg border border-border/30 shadow-[0_2px_12px_rgba(0,0,0,0.25)] overflow-hidden">
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full h-[65vh] bg-white"
                    title={previewCv.name}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[65vh] text-muted-foreground text-sm">
                  Carregando conteudo...
                </div>
              )}
            </div>

            <div className="flex items-center justify-between bg-card px-6 py-4 border-t border-border/50">
              <div className="flex gap-2">
                <button
                  onClick={() => handleScore(previewCvId)}
                  className="px-4 py-1.5 bg-success/10 hover:bg-success/20 rounded text-xs font-medium text-success transition-colors"
                >
                  +1 Performance
                </button>
                <button
                  onClick={() => handleDelete(previewCvId)}
                  className="px-4 py-1.5 bg-error/10 hover:bg-error/20 rounded text-xs font-medium text-error transition-colors"
                >
                  Excluir
                </button>
              </div>
              <button
                onClick={handleDownload}
                disabled={downloading || !previewHtml}
                className="flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent/80 rounded-lg text-sm font-semibold text-accent-foreground disabled:opacity-50 transition-colors"
              >
                {downloading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                    Baixando...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
                      <path d="M8 1.5v9m0 0L4.5 7M8 10.5l3.5-3.5M2.5 13h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Baixar PDF
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
