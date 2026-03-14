import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  IconButton,
  CircularProgress,
} from '@mui/material'
import { API_URL } from '@/lib/api'

interface SearchEntry {
  query: string
  location: string
  maxResults: number
}

const DEFAULT_SEARCH: SearchEntry = { query: '', location: 'Brasil', maxResults: 50 }

interface ScrapeResult {
  newJobs: number
  skipped: number
}

export function ScrapeControls({ onComplete }: { onComplete?: () => void }) {
  const [searches, setSearches] = useState<SearchEntry[]>([{ ...DEFAULT_SEARCH }])
  const [scraping, setScraping] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ScrapeResult | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/settings/searches`)
      .then((r) => r.json())
      .then((data: { value?: string }) => {
        if (!data.value) return
        try {
          const parsed = JSON.parse(data.value) as { searches?: SearchEntry[] }
          if (parsed.searches?.length) {
            setSearches(
              parsed.searches.map((s) => ({
                query: s.query || '',
                location: s.location || 'Brasil',
                maxResults: s.maxResults ?? 50,
              }))
            )
          }
        } catch {}
      })
      .catch(() => {})
  }, [])

  const addSearch = useCallback(() => {
    setSearches((prev) => [...prev, { ...DEFAULT_SEARCH }])
  }, [])

  const removeSearch = useCallback((idx: number) => {
    setSearches((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const updateSearch = useCallback(
    (idx: number, field: keyof SearchEntry, value: string | number) => {
      setSearches((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
    },
    []
  )

  const handleSave = useCallback(async () => {
    const valid = searches.filter((s) => s.query.trim())
    if (valid.length === 0) return
    setSaving(true)
    try {
      await fetch(`${API_URL}/api/settings/searches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify({ searches: valid }) }),
      })
    } finally {
      setSaving(false)
    }
  }, [searches])

  const handleScrape = useCallback(async () => {
    const valid = searches.filter((s) => s.query.trim())
    if (valid.length === 0) return

    setScraping(true)
    setResult(null)
    try {
      const res = await fetch(`${API_URL}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searches: valid }),
      })
      const data = (await res.json()) as {
        ok: boolean
        newJobs: number
        skipped: number
        message: string
      }
      setResult({ newJobs: data.newJobs, skipped: data.skipped })
      onComplete?.()

      await fetch(`${API_URL}/api/settings/searches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify({ searches: valid }) }),
      })
    } catch {
      setResult({ newJobs: 0, skipped: 0 })
    } finally {
      setScraping(false)
    }
  }, [searches, onComplete])

  const allEmpty = searches.every((s) => !s.query.trim())

  return (
    <Card>
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 3 }}>
          <Box>
            <Typography variant="subtitle1">Coletar Vagas</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Busca vagas direto na API do Indeed — sem extensão, sem browser
            </Typography>
          </Box>

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              disabled={saving || allEmpty}
              onClick={handleSave}
              sx={{ minWidth: 80 }}
            >
              {saving ? <CircularProgress size={16} /> : 'Salvar'}
            </Button>
            <Button
              variant="contained"
              size="small"
              disabled={scraping || allEmpty}
              onClick={handleScrape}
              sx={{ minWidth: 100 }}
            >
              {scraping ? <CircularProgress size={16} color="inherit" /> : 'Coletar'}
            </Button>
          </Stack>
        </Stack>

        <Stack spacing={1.5}>
          {searches.map((s, idx) => (
            <Stack key={idx} direction="row" spacing={1.5} alignItems="center">
              <TextField
                size="small"
                placeholder="react OR nodejs OR typescript"
                value={s.query}
                onChange={(e) => updateSearch(idx, 'query', e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                placeholder="Brasil"
                value={s.location}
                onChange={(e) => updateSearch(idx, 'location', e.target.value)}
                sx={{ width: 160 }}
              />
              <TextField
                size="small"
                type="number"
                value={s.maxResults}
                onChange={(e) => updateSearch(idx, 'maxResults', parseInt(e.target.value) || 50)}
                slotProps={{ htmlInput: { min: 1, max: 500 } }}
                sx={{ width: 80 }}
              />
              {searches.length > 1 && (
                <IconButton
                  size="small"
                  onClick={() => removeSearch(idx)}
                  sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                >
                  ✕
                </IconButton>
              )}
            </Stack>
          ))}
        </Stack>

        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button variant="text" size="small" onClick={addSearch} sx={{ textTransform: 'none' }}>
            + Adicionar busca
          </Button>
        </Box>

        {result && (
          <Alert
            severity={result.newJobs > 0 ? 'success' : 'info'}
            sx={{ mt: 2 }}
          >
            {result.newJobs > 0
              ? `${result.newJobs} novas vagas coletadas`
              : 'Nenhuma vaga nova encontrada'}
            {result.skipped > 0 && ` · ${result.skipped} duplicadas`}
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
