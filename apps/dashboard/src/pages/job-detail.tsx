import useSWR from 'swr'
import { useParams, Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackIcon from '@mui/icons-material/ArrowBackRounded'
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineRounded'
import { fetcher, API_URL } from '@/lib/api'
import { STATUS_LABELS } from '@/lib/status-labels'

type Job = Record<string, unknown>

const STATUS_CHIP_COLOR: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  discovered: 'default',
  enriched: 'info',
  scored: 'secondary',
  tailored: 'secondary',
  ready: 'warning',
  applying: 'warning',
  applied: 'success',
  failed: 'error',
  skipped: 'default',
}

function parseTailoredCv(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return String(raw)
  }
}

export default function JobDetailPage() {
  const { id } = useParams()
  const { data: job, error } = useSWR<Job>(`${API_URL}/api/jobs/${id}`, fetcher)

  if (error) {
    return (
      <Stack spacing={2} sx={{ alignItems: 'center', py: 8 }}>
        <ErrorOutlineIcon sx={{ fontSize: 48, color: 'error.main' }} />
        <Typography color="error">Falha ao carregar vaga</Typography>
      </Stack>
    )
  }

  if (!job) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  const status = String(job.status ?? '')
  const tailoredCv = parseTailoredCv(job.tailoredCv)
  const cvFilename = typeof job.cvPdfPath === 'string' ? job.cvPdfPath.split('/').pop() : null
  const coverFilename = typeof job.coverPdfPath === 'string' ? job.coverPdfPath.split('/').pop() : null

  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Button
        component={RouterLink}
        to="/jobs"
        startIcon={<ArrowBackIcon />}
        color="inherit"
        sx={{ alignSelf: 'flex-start' }}
      >
        Voltar
      </Button>

      <Box>
        <Typography variant="h4">{String(job.title || 'Sem titulo')}</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          {String(job.company || '')}
          {job.location ? ` — ${String(job.location)}` : ''}
        </Typography>
      </Box>

      <Stack direction="row" spacing={2}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Situacao</Typography>
            <Box sx={{ mt: 1 }}>
              <Chip
                label={STATUS_LABELS[status] || status}
                color={STATUS_CHIP_COLOR[status] || 'default'}
                variant="filled"
              />
            </Box>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Pontuacao</Typography>
            <Typography variant="h4" sx={{ mt: 0.5, fontFamily: 'monospace' }}>
              {job.score != null ? String(job.score) : '—'}
            </Typography>
            {typeof job.scoreReason === 'string' && job.scoreReason && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {job.scoreReason}
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Origem</Typography>
            <Typography variant="body1" sx={{ mt: 0.5, textTransform: 'capitalize' }}>
              {String(job.source || '—')}
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Tipo</Typography>
            <Typography variant="body1" sx={{ mt: 0.5 }}>
              {job.applyType === 'easy_apply' ? 'Indeed Apply' : job.applyType === 'external' ? 'Externo' : '—'}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      {typeof job.description === 'string' && job.description && (
        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Descricao
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {job.description}
            </Typography>
          </CardContent>
        </Card>
      )}

      {tailoredCv && (
        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Dados do CV Personalizado
            </Typography>
            <Box
              component="pre"
              sx={{
                fontSize: 12,
                color: 'text.secondary',
                overflow: 'auto',
                maxHeight: 384,
                fontFamily: 'monospace',
                m: 0,
              }}
            >
              {tailoredCv}
            </Box>
          </CardContent>
        </Card>
      )}

      {(cvFilename || coverFilename) && (
        <Card>
          <CardContent>
            <Typography variant="overline" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              PDFs
            </Typography>
            <Stack direction="row" spacing={2}>
              {cvFilename && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon />}
                  href={`${API_URL}/api/pdf/${cvFilename}`}
                  target="_blank"
                  rel="noopener"
                >
                  Baixar CV
                </Button>
              )}
              {coverFilename && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon />}
                  href={`${API_URL}/api/pdf/${coverFilename}`}
                  target="_blank"
                  rel="noopener"
                >
                  Baixar Carta de Apresentacao
                </Button>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {typeof job.failReason === 'string' && job.failReason && (
        <Card sx={(t) => ({ border: `1px solid ${t.palette.error.dark}` })}>
          <CardContent>
            <Typography variant="overline" color="error" sx={{ mb: 1, display: 'block' }}>
              Motivo da Falha
            </Typography>
            <Typography variant="body2" color="error.light">
              {job.failReason}
            </Typography>
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}
