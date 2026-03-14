import { useState, useEffect, useCallback } from 'react'
import { API_URL } from '@/lib/api'
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'

interface ScrapeConfig {
  indeed: number
  linkedin: number
  applyMode: 'semi-auto' | 'full-auto'
  scoreEasyApply: number
  scoreExternal: number
  maxJobAge: number
}

const DEFAULT_SCRAPE: ScrapeConfig = { indeed: 50, linkedin: 0, applyMode: 'semi-auto', scoreEasyApply: 40, scoreExternal: 60, maxJobAge: 72 }

export default function SettingsPage() {
  const [profile, setProfile] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [scrape, setScrape] = useState<ScrapeConfig>(DEFAULT_SCRAPE)
  const [scrapeSaving, setScrapeSaving] = useState(false)
  const [scrapeSaved, setScrapeSaved] = useState(false)


  useEffect(() => {
    fetch(`${API_URL}/api/settings/profile`)
      .then((r) => r.json())
      .then((data: { value?: string }) => setProfile(data.value || ''))
      .catch(() => {})

    fetch(`${API_URL}/api/settings/scrapeConfig`)
      .then((r) => r.json())
      .then((data: { value?: string }) => {
        if (data.value) {
          try {
            setScrape({ ...DEFAULT_SCRAPE, ...JSON.parse(data.value) })
          } catch {
            /* empty */
          }
        }
      })
      .catch(() => {})

  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`${API_URL}/api/settings/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: profile }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [profile])

  const saveScrape = useCallback(async () => {
    setScrapeSaving(true)
    setScrapeSaved(false)
    try {
      await fetch(`${API_URL}/api/settings/scrapeConfig`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(scrape) }),
      })
      setScrapeSaved(true)
      setTimeout(() => setScrapeSaved(false), 2000)
    } finally {
      setScrapeSaving(false)
    }
  }, [scrape])



  return (
    <Stack spacing={3} sx={{ maxWidth: 900, mx: 'auto', width: '100%' }}>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          Configuracoes
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Gerencie seu perfil e configuracoes de coleta.
        </Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="subtitle2">Perfil</Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5, maxWidth: 480 }}
              >
                Escreva tudo sobre voce: nome, e-mail, telefone, localizacao, links, experiencia,
                educacao, habilidades, idiomas. A IA vai extrair o que precisar para preencher
                formularios e gerar CVs.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, ml: 2 }}>
              {saved && (
                <Typography variant="caption" color="success.main">
                  Salvo
                </Typography>
              )}
              <Button variant="contained" size="small" onClick={save} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </Stack>
          </Stack>
          <TextField
            multiline
            rows={24}
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
              'Portfolio: https://diegohorvatti.dev',
              '',
              '## Summary',
              'Senior Full Stack Developer with 6+ years of experience...',
              '',
              '## Experience',
              '**Senior Developer** — Company X (2022-Present)',
              '- Built microservices architecture using Node.js, TypeScript',
              '- Led migration from monolith to event-driven architecture',
              '...',
              '',
              '## Education',
              'Computer Science — University ABC (2018-2022)',
              '',
              '## Skills',
              'TypeScript, React, Node.js, Python, PostgreSQL, Redis, Docker, AWS',
              '',
              '## Languages',
              'Portuguese (native), English (fluent), Spanish (intermediate)',
              '',
              '## Additional',
              'CPF: 123.456.789-00',
              'RG: 12.345.678-9',
              'Birth date: 1995-03-15',
            ].join('\n')}
            spellCheck={false}
            sx={{
              mt: 2,
              '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: 14 },
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="subtitle2">Coleta</Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
              >
                Limites de coleta e filtros por plataforma
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, ml: 2 }}>
              {scrapeSaved && (
                <Typography variant="caption" color="success.main">
                  Salvo
                </Typography>
              )}
              <Button
                variant="contained"
                size="small"
                onClick={saveScrape}
                disabled={scrapeSaving}
              >
                {scrapeSaving ? 'Salvando...' : 'Salvar'}
              </Button>
            </Stack>
          </Stack>

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1.5, display: 'block' }}>
              Score minimo por tipo de vaga
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label="Easy Apply"
                  type="number"
                  size="small"
                  fullWidth
                  value={scrape.scoreEasyApply}
                  onChange={(e) => setScrape((s) => ({ ...s, scoreEasyApply: parseInt(e.target.value) || 0 }))}
                  inputProps={{ min: 0, max: 100 }}
                  helperText="Vagas Easy Apply abaixo deste score serao ignoradas"
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label="Externa"
                  type="number"
                  size="small"
                  fullWidth
                  value={scrape.scoreExternal}
                  onChange={(e) => setScrape((s) => ({ ...s, scoreExternal: parseInt(e.target.value) || 0 }))}
                  inputProps={{ min: 0, max: 100 }}
                  helperText="Vagas externas exigem score maior"
                />
              </Grid>
            </Grid>
          </Box>

          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1.5, display: 'block' }}>
              Limite de coleta por plataforma
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 4 }}>
                <TextField
                  label="Indeed"
                  type="number"
                  size="small"
                  fullWidth
                  value={scrape.indeed}
                  onChange={(e) => setScrape((s) => ({ ...s, indeed: parseInt(e.target.value) || 0 }))}
                  inputProps={{ min: 0, max: 500 }}
                />
              </Grid>
              <Grid size={{ xs: 4 }}>
                <TextField
                  label="LinkedIn"
                  type="number"
                  size="small"
                  fullWidth
                  value={scrape.linkedin}
                  onChange={(e) => setScrape((s) => ({ ...s, linkedin: parseInt(e.target.value) || 0 }))}
                  inputProps={{ min: 0, max: 500 }}
                />
              </Grid>
              <Grid size={{ xs: 4 }}>
                <TextField
                  label="Idade max (horas)"
                  type="number"
                  size="small"
                  fullWidth
                  value={scrape.maxJobAge}
                  onChange={(e) => setScrape((s) => ({ ...s, maxJobAge: parseInt(e.target.value) || 72 }))}
                  inputProps={{ min: 1 }}

                />
              </Grid>
            </Grid>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  )
}
