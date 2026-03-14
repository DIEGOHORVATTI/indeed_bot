import { useState, useEffect, useCallback } from 'react'
import useSWR, { mutate } from 'swr'
import { API_URL, fetcher } from '@/lib/api'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import CloseRounded from '@mui/icons-material/CloseRounded'
import PersonIcon from '@mui/icons-material/PersonOutlineRounded'

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
  { id: 'classic', name: 'Classico', description: 'Layout limpo e profissional, foco em ATS' },
  { id: 'modern', name: 'Moderno', description: 'Design contemporaneo com sidebar de habilidades' },
  { id: 'minimal', name: 'Minimalista', description: 'Menos e mais — direto ao ponto' },
]

const VARIANTS = ['A', 'B', 'C', 'D', 'E']

const VARIANT_COLORS: Record<string, { bgcolor: string; color: string }> = {
  A: { bgcolor: alpha('#61F3F3', 0.1), color: '#61F3F3' },
  B: { bgcolor: alpha('#C684FF', 0.1), color: '#C684FF' },
  C: { bgcolor: alpha('#FFD666', 0.1), color: '#FFD666' },
  D: { bgcolor: alpha('#77ED8B', 0.1), color: '#77ED8B' },
  E: { bgcolor: alpha('#FFAC82', 0.1), color: '#FFAC82' },
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
  const from = COLOR_PALETTES.find((c) => c.id === fromId) || COLOR_PALETTES[0]
  const to = COLOR_PALETTES.find((c) => c.id === toId) || COLOR_PALETTES[0]
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

function TemplatePreview({ templateId }: { templateId: string }) {
  const bar = (w: number | string, h: number, color: string) => (
    <Box sx={{ width: w, height: h, bgcolor: color, borderRadius: 0.25 }} />
  )

  if (templateId === 'classic') {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          bgcolor: '#fff',
          borderRadius: 1,
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
        }}
      >
        {bar(80, 12, '#1F2937')}
        {bar(112, 6, '#D1D5DB')}
        <Box sx={{ mt: 1, height: 2, width: '100%', bgcolor: '#E5E7EB' }} />
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {bar(64, 8, '#374151')}
          {bar('100%', 6, '#E5E7EB')}
          {bar('80%', 6, '#E5E7EB')}
          {bar('100%', 6, '#E5E7EB')}
        </Stack>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {bar(80, 8, '#374151')}
          {bar('100%', 6, '#E5E7EB')}
          {bar('75%', 6, '#E5E7EB')}
        </Stack>
      </Box>
    )
  }

  if (templateId === 'modern') {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          bgcolor: '#fff',
          borderRadius: 1,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            width: '33%',
            bgcolor: '#1F2937',
            p: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            alignItems: 'center',
          }}
        >
          <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: '#4B5563' }} />
          {bar('100%', 6, '#4B5563')}
          <Stack spacing={0.5} sx={{ mt: 1, width: '100%' }}>
            {bar('75%', 6, '#6B7280')}
            {bar('100%', 6, '#6B7280')}
            {bar('66%', 6, '#6B7280')}
          </Stack>
        </Box>
        <Box
          sx={{
            flex: 1,
            p: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          {bar(80, 12, '#1F2937')}
          {bar('100%', 6, '#E5E7EB')}
          {bar('80%', 6, '#E5E7EB')}
          <Box sx={{ mt: 0.5 }}>{bar(64, 8, '#374151')}</Box>
          {bar('100%', 6, '#E5E7EB')}
          {bar('75%', 6, '#E5E7EB')}
        </Box>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        bgcolor: '#fff',
        borderRadius: 1,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {bar(96, 16, '#111827')}
      {bar(64, 4, '#D1D5DB')}
      <Stack spacing={1} sx={{ mt: 1.5 }}>
        {bar('100%', 6, '#E5E7EB')}
        {bar('60%', 6, '#E5E7EB')}
      </Stack>
      <Stack spacing={1} sx={{ mt: 1.5 }}>
        {bar('100%', 6, '#E5E7EB')}
        {bar('80%', 6, '#E5E7EB')}
      </Stack>
    </Box>
  )
}

export default function CvsPage() {
  const { data: cvs, mutate: mutateCvs } = useSWR<CV[]>(`${API_URL}/api/cvs`, fetcher)
  const { data: jobs } = useSWR<Job[]>(`${API_URL}/api/jobs`, fetcher)

  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  useEffect(() => {
    if (!profileOpen) return
    fetch(`${API_URL}/api/settings/profile`)
      .then((r) => r.json())
      .then((data: { value?: string }) => setProfile(data.value || ''))
      .catch(() => {})
  }, [profileOpen])

  const saveProfile = useCallback(async () => {
    setProfileSaving(true)
    setProfileSaved(false)
    try {
      await fetch(`${API_URL}/api/settings/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: profile }),
      })
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2000)
    } finally {
      setProfileSaving(false)
    }
  }, [profile])

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

  const openGenModal = (templateId?: string) => {
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
    if (!confirm('Excluir este curriculo?')) return
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
    } catch {
      /* empty */
    }
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
      /* empty */
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

  const variantChip = (variant: string) => {
    const colors = VARIANT_COLORS[variant] ?? { bgcolor: alpha('#919EAB', 0.1), color: '#919EAB' }
    return (
      <Chip
        label={variant}
        size="small"
        sx={{ fontWeight: 700, fontSize: 12, bgcolor: colors.bgcolor, color: colors.color }}
      />
    )
  }

  const paletteCircle = (
    p: (typeof COLOR_PALETTES)[number],
    selected: boolean,
    onClick: () => void,
    size = 24,
  ) => (
    <Tooltip key={p.id} title={p.name}>
      <Box
        onClick={onClick}
        sx={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '50%',
          bgcolor: p.primary,
          cursor: 'pointer',
          transition: 'all 0.15s',
          outline: selected ? '2px solid' : 'none',
          outlineColor: 'primary.main',
          outlineOffset: 2,
          transform: selected ? 'scale(1.1)' : 'scale(1)',
          '&:hover': { transform: 'scale(1.1)' },
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: '50%',
            bgcolor: p.accent,
            border: '1.5px solid #fff',
          }}
        />
      </Box>
    </Tooltip>
  )

  return (
    <Stack spacing={3} sx={{ maxWidth: 900, mx: 'auto', width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Curriculos
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Gerador de CV com teste A/B — acompanhe qual versao performa melhor
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" startIcon={<PersonIcon />} onClick={() => setProfileOpen(true)}>
            Meu Perfil
          </Button>
          <Button variant="outlined" size="small" onClick={() => mutateCvs()}>
            Atualizar
          </Button>
          <Button variant="contained" size="small" onClick={() => openGenModal()}>
            Gerar Novo CV
          </Button>
        </Stack>
      </Stack>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          Templates
        </Typography>
        <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 1 }}>
          {TEMPLATES.map((t) => (
            <Card key={t.id} sx={{ minWidth: 200, width: 200, flexShrink: 0 }}>
              <Box sx={{ height: 180, p: 1, bgcolor: (th) => alpha(th.palette.grey[500], 0.08) }}>
                <TemplatePreview templateId={t.id} />
              </Box>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="subtitle2">{t.name}</Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.5, lineHeight: 1.4 }}
                >
                  {t.description}
                </Typography>
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => openGenModal(t.id)}
                  sx={{ mt: 1 }}
                >
                  Usar
                </Button>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Box>

      {!cvs ? (
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 4 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Carregando curriculos...
          </Typography>
        </Stack>
      ) : cvs.length === 0 ? (
        <Card>
          <CardContent sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Nenhum curriculo gerado ainda. Clique em &apos;Gerar Novo CV&apos; para comecar.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {cvs.map((cv: CV) => (
            <Grid key={cv.id} size={{ xs: 12, lg: 6 }}>
              <Card>
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <Stack spacing={1.5}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="subtitle2">{cv.name}</Typography>
                        {variantChip(cv.variant)}
                      </Stack>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                          px: 1.5,
                          py: 0.5,
                          borderRadius: 1,
                          bgcolor: cv.score > 0
                            ? (t) => alpha(t.palette.success.main, 0.1)
                            : (t) => alpha(t.palette.grey[500], 0.1),
                          color: cv.score > 0 ? 'success.main' : 'text.secondary',
                        }}
                      >
                        <Typography variant="body1" fontWeight={700}>
                          {cv.score}
                        </Typography>
                        <Typography
                          variant="caption"
                          fontWeight={700}
                          onClick={() => handleScore(cv.id)}
                          sx={{
                            cursor: 'pointer',
                            '&:hover': { opacity: 0.7 },
                            transition: 'opacity 0.2s',
                          }}
                        >
                          +1
                        </Typography>
                      </Box>
                    </Stack>

                    {cv.jobTitle && (
                      <Typography variant="caption" color="text.secondary">
                        Para: {cv.jobTitle}
                        {cv.jobCompany ? ` @ ${cv.jobCompany}` : ''}
                      </Typography>
                    )}

                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        {new Date(cv.createdAt).toLocaleDateString('pt-BR')}
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => setPreviewCvId(cv.id)}
                        >
                          Visualizar
                        </Button>
                        <Button
                          size="small"
                          onClick={() => handleDelete(cv.id)}
                          sx={{
                            color: 'error.main',
                            bgcolor: (t) => alpha(t.palette.error.main, 0.08),
                            '&:hover': {
                              bgcolor: (t) => alpha(t.palette.error.main, 0.16),
                            },
                          }}
                        >
                          Excluir
                        </Button>
                      </Stack>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog
        open={showGenModal}
        onClose={() => setShowGenModal(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { maxHeight: '90vh' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" fontWeight={700}>
            Gerar Novo CV
          </Typography>
          <IconButton size="small" onClick={() => setShowGenModal(false)}>
            <CloseRounded fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={2.5}>
            <TextField
              label="Nome do CV"
              size="small"
              fullWidth
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="CV para Vaga X — Variante A"
            />

            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <TextField
                  select
                  label="Variante"
                  size="small"
                  fullWidth
                  value={formVariant}
                  onChange={(e) => setFormVariant(e.target.value)}
                >
                  {VARIANTS.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  select
                  label="Template"
                  size="small"
                  fullWidth
                  value={formTemplate}
                  onChange={(e) => setFormTemplate(e.target.value)}
                >
                  {TEMPLATES.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                Paleta de Cores
              </Typography>
              <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5 }}>
                {COLOR_PALETTES.map((p) => (
                  <Box
                    key={p.id}
                    onClick={() => setFormPalette(p.id)}
                    sx={{
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1.5,
                      py: 1,
                      borderRadius: 1.5,
                      border: 1,
                      borderColor: formPalette === p.id ? 'primary.main' : 'divider',
                      bgcolor:
                        formPalette === p.id
                          ? (t) => alpha(t.palette.primary.main, 0.08)
                          : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      '&:hover': {
                        bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <Box sx={{ position: 'relative', width: 24, height: 24, flexShrink: 0 }}>
                      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: p.primary }} />
                      <Box
                        sx={{
                          position: 'absolute',
                          bottom: -2,
                          right: -2,
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: p.accent,
                          border: 2,
                          borderColor: 'background.paper',
                        }}
                      />
                    </Box>
                    <Box>
                      <Typography
                        variant="caption"
                        fontWeight={500}
                        sx={{ lineHeight: 1.2, display: 'block' }}
                      >
                        {p.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontSize: 10, lineHeight: 1.2, display: 'block' }}
                      >
                        {p.desc}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>

            <TextField
              label="Instrucoes adicionais (opcional)"
              size="small"
              fullWidth
              multiline
              minRows={3}
              value={formExtraInstructions}
              onChange={(e) => setFormExtraInstructions(e.target.value)}
              placeholder="Ex: Tenho disponibilidade imediata, mencionar experiencia com Kubernetes, destacar lideranca de equipes remotas..."
            />

            <TextField
              label="Descricao da Vaga (opcional)"
              size="small"
              fullWidth
              multiline
              minRows={6}
              value={formJobDesc}
              onChange={(e) => setFormJobDesc(e.target.value)}
              placeholder="Cole a descricao completa da vaga alvo..."
            />

            <TextField
              select
              label="Vaga vinculada (opcional)"
              size="small"
              fullWidth
              value={formJobId}
              onChange={(e) => handleJobSelect(e.target.value)}
            >
              <MenuItem value="">Nenhuma</MenuItem>
              {jobs?.map((j: Job) => (
                <MenuItem key={j.id} value={j.id}>
                  {j.title} — {j.company}
                </MenuItem>
              ))}
            </TextField>

            {genError && <Alert severity="error">{genError}</Alert>}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            variant="contained"
            fullWidth
            onClick={handleGenerate}
            disabled={generating}
            startIcon={generating ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {generating ? 'Gerando curriculo com IA...' : 'Gerar CV com IA'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!previewCvId}
        onClose={() => setPreviewCvId(null)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: { height: '90vh', display: 'flex', flexDirection: 'column' },
        }}
      >
        <Box sx={{ px: 3, pt: 3, pb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h6" fontWeight={700}>
              {previewCv?.name || 'Carregando...'}
            </Typography>
            {previewCv?.variant && variantChip(previewCv.variant)}
            {previewCv && (
              <Chip
                label={`Score: ${previewCv.score}`}
                size="small"
                sx={{
                  fontWeight: 700,
                  bgcolor: previewCv.score > 0
                    ? (t) => alpha(t.palette.success.main, 0.1)
                    : undefined,
                  color: previewCv.score > 0 ? 'success.main' : 'text.secondary',
                }}
              />
            )}
          </Stack>
          <IconButton size="small" onClick={() => setPreviewCvId(null)}>
            <CloseRounded fontSize="small" />
          </IconButton>
        </Box>

        <Box
          sx={{
            mx: 3,
            mb: 2,
            p: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            bgcolor: (t) => alpha(t.palette.grey[500], 0.06),
            borderRadius: 1.5,
            border: 1,
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
              Paleta:
            </Typography>
            {COLOR_PALETTES.map((p) =>
              paletteCircle(p, previewPalette === p.id, () => setPreviewPalette(p.id)),
            )}
          </Stack>

          <Box sx={{ height: 20, width: '1px', bgcolor: 'divider' }} />

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Template</InputLabel>
            <Select
              value={previewTemplate}
              onChange={(e) => setPreviewTemplate(e.target.value)}
              label="Template"
            >
              {TEMPLATES.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="contained"
            size="small"
            onClick={handleSavePreview}
            disabled={savingPreview}
            sx={{ ml: 'auto' }}
          >
            {savingPreview ? 'Salvando...' : 'Salvar alteracoes'}
          </Button>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, mx: 3 }}>
          {previewCv?.htmlContent ? (
            <Box
              sx={{
                height: '100%',
                borderRadius: 2,
                border: 1,
                borderColor: 'divider',
                boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
                overflow: 'hidden',
              }}
            >
              <Box
                component="iframe"
                srcDoc={previewHtml}
                title={previewCv.name}
                sx={{ width: '100%', height: '100%', border: 'none', bgcolor: '#fff' }}
              />
            </Box>
          ) : (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{ height: '100%' }}
              spacing={1}
              direction="row"
            >
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                Carregando conteudo...
              </Typography>
            </Stack>
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              onClick={() => handleScore(previewCvId!)}
              sx={{
                color: 'success.main',
                bgcolor: (t) => alpha(t.palette.success.main, 0.08),
                '&:hover': { bgcolor: (t) => alpha(t.palette.success.main, 0.16) },
              }}
            >
              +1 Performance
            </Button>
            <Button
              size="small"
              onClick={() => handleDelete(previewCvId!)}
              sx={{
                color: 'error.main',
                bgcolor: (t) => alpha(t.palette.error.main, 0.08),
                '&:hover': { bgcolor: (t) => alpha(t.palette.error.main, 0.16) },
              }}
            >
              Excluir
            </Button>
          </Stack>
          <Button
            variant="contained"
            onClick={handleDownload}
            disabled={downloading || !previewHtml}
            startIcon={downloading ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {downloading ? 'Baixando...' : 'Baixar PDF'}
          </Button>
        </Box>
      </Dialog>

      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Meu Perfil</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Escreva tudo sobre voce: nome, e-mail, telefone, localizacao, links, experiencia,
            educacao, habilidades, idiomas. A IA vai extrair o que precisar para preencher
            formularios e gerar CVs.
          </Typography>
          <TextField
            multiline
            rows={20}
            fullWidth
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            placeholder={[
              'Diego Horvatti',
              'diego@email.com',
              '+55 11 99999-9999',
              'Sao Paulo, Brazil',
              '',
              'LinkedIn: https://linkedin.com/in/diegohorvatti',
              'GitHub: https://github.com/diegohorvatti',
              '',
              '## Resumo',
              'Desenvolvedor Full Stack Senior com 6+ anos de experiencia...',
              '',
              '## Experiencia',
              '**Senior Developer** - Company X (2022-Presente)',
              '- Microservicos com Node.js, TypeScript',
              '',
              '## Educacao',
              'Ciencia da Computacao - Universidade ABC (2018-2022)',
              '',
              '## Habilidades',
              'TypeScript, React, Node.js, Python, PostgreSQL, Docker, AWS',
              '',
              '## Idiomas',
              'Portugues (nativo), Ingles (fluente)',
            ].join('\n')}
            spellCheck={false}
            sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: 14 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {profileSaved && (
            <Typography variant="caption" color="success.main" sx={{ mr: 1 }}>
              Salvo
            </Typography>
          )}
          <Button onClick={() => setProfileOpen(false)} color="inherit">Fechar</Button>
          <Button variant="contained" onClick={saveProfile} disabled={profileSaving}>
            {profileSaving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
