import { useState, useCallback, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { alpha } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TablePagination from '@mui/material/TablePagination'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import InputAdornment from '@mui/material/InputAdornment'
import CircularProgress from '@mui/material/CircularProgress'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import SearchIcon from '@mui/icons-material/SearchRounded'
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded'
import SendIcon from '@mui/icons-material/SendRounded'
import CloseIcon from '@mui/icons-material/CloseRounded'
import FilterListOffIcon from '@mui/icons-material/FilterListOff'
import AddIcon from '@mui/icons-material/AddRounded'
import CloudDownloadIcon from '@mui/icons-material/CloudDownloadRounded'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Alert from '@mui/material/Alert'
import Switch from '@mui/material/Switch'
import Divider from '@mui/material/Divider'
import { fetcher, API_URL } from '@/lib/api'
import { STATUS_LABELS } from '@/lib/status-labels'

type Job = Record<string, unknown>

type SortField = 'title' | 'company' | 'location' | 'score' | 'status' | 'updatedAt'
type SortDir = 'asc' | 'desc'

const ALL_STATUSES = [
  'discovered', 'enriched', 'scored', 'tailored',
  'ready', 'applying', 'applied', 'failed', 'skipped',
] as const

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

const APPLY_TYPE_LABELS: Record<string, string> = {
  easy_apply: 'Indeed Apply',
  external: 'Externo',
}

function compareJobs(a: Job, b: Job, field: SortField): number {
  const av = a[field]
  const bv = b[field]
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  if (typeof av === 'number' && typeof bv === 'number') return av - bv
  return String(av).localeCompare(String(bv), 'pt-BR', { sensitivity: 'base' })
}

interface SearchEntry {
  query: string
  location: string
  maxResults: number
  country: string
  hoursOld: number
  easyApplyOnly: boolean
}

const DEFAULT_SEARCH: SearchEntry = { query: '', location: 'Brasil', maxResults: 50, country: 'BR', hoursOld: 72, easyApplyOnly: false }

const PLATFORMS = [
  { id: 'indeed', label: 'Indeed', available: true },
  { id: 'linkedin', label: 'LinkedIn', available: false },
  { id: 'glassdoor', label: 'Glassdoor', available: false },
] as const

export function JobTable() {
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [applyTypeFilter, setApplyTypeFilter] = useState('')
  const [searchFilter, setSearchFilter] = useState('')

  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [deleting, setDeleting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [showModePicker, setShowModePicker] = useState(false)
  const [generateCv, setGenerateCv] = useState(false)

  const [sortField, setSortField] = useState<SortField>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const url = useMemo(() => {
    const params = new URLSearchParams()
    params.set('limit', '200')
    if (statusFilter) params.set('status', statusFilter)
    if (sourceFilter) params.set('source', sourceFilter)
    if (applyTypeFilter) params.set('applyType', applyTypeFilter)
    if (searchFilter) params.set('search', searchFilter)
    return `${API_URL}/api/jobs?${params.toString()}`
  }, [statusFilter, sourceFilter, applyTypeFilter, searchFilter])

  const { data: jobs, mutate } = useSWR<Job[]>(url, fetcher, { refreshInterval: 5000 })

  const { data: stats } = useSWR<{ status: string; count: number }[]>(
    `${API_URL}/api/jobs/stats`,
    fetcher,
    { refreshInterval: 5000 },
  )

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {}
    let total = 0
    for (const s of stats ?? []) {
      map[s.status] = s.count
      total += s.count
    }
    map[''] = total
    return map
  }, [stats])

  const [scrapeOpen, setScrapeOpen] = useState(false)
  const [searches, setSearches] = useState<SearchEntry[]>([{ ...DEFAULT_SEARCH }])
  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<{ newJobs: number; skipped: number } | null>(null)

  useEffect(() => {
    if (!scrapeOpen) return
    fetch(`${API_URL}/api/settings/searches`)
      .then((r) => r.json())
      .then((data: { value?: string }) => {
        if (!data.value) return
        try {
          const parsed = JSON.parse(data.value) as { searches?: SearchEntry[] }
          if (parsed.searches?.length) {
            setSearches(parsed.searches.map((s) => ({ ...DEFAULT_SEARCH, ...s })))
          }
        } catch {}
      })
      .catch(() => {})
  }, [scrapeOpen])

  const handleScrape = useCallback(async () => {
    const valid = searches.filter((s) => s.query.trim())
    if (valid.length === 0) return
    setScraping(true)
    setScrapeResult(null)
    try {
      const res = await fetch(`${API_URL}/api/scrape`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searches: valid.map((s) => ({ query: s.query, location: s.location, maxResults: s.maxResults, country: s.country, hoursOld: s.hoursOld, easyApplyOnly: s.easyApplyOnly })) }) })
      const data = (await res.json()) as { ok: boolean; newJobs: number; skipped: number }
      setScrapeResult({ newJobs: data.newJobs, skipped: data.skipped })
      await fetch(`${API_URL}/api/settings/searches`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: JSON.stringify({ searches: valid }) }) })
      mutate()
    } catch { setScrapeResult({ newJobs: 0, skipped: 0 }) }
    finally { setScraping(false) }
  }, [searches, mutate])

  const sortedJobs = useMemo(() => {
    const list = jobs ?? []
    const sorted = [...list].sort((a, b) => compareJobs(a, b, sortField))
    return sortDir === 'desc' ? sorted.reverse() : sorted
  }, [jobs, sortField, sortDir])

  const paginatedJobs = useMemo(
    () => sortedJobs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [sortedJobs, page, rowsPerPage],
  )

  const allIds = useMemo(() => sortedJobs.map((j) => Number(j.id)), [sortedJobs])
  const allSelected = sortedJobs.length > 0 && selected.size === sortedJobs.length

  const handleSort = useCallback((field: SortField) => {
    setSortDir((prev) => (sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'))
    setSortField(field)
  }, [sortField])

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
      prev.size === allIds.length ? new Set() : new Set(allIds),
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

  const handleApply = useCallback(async (mode: 'semi-auto' | 'full-auto') => {
    if (selected.size === 0) return
    setApplying(true)
    try {
      const res = await fetch(`${API_URL}/api/extension/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: Array.from(selected), mode, generateCv }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) {
        alert(data.error || 'Erro ao enviar comando de aplicacao')
        return
      }
      setSelected(new Set())
      setShowModePicker(false)
      mutate()
    } catch {
      alert('Erro de conexao com o servidor')
    } finally {
      setApplying(false)
    }
  }, [selected, mutate, generateCv])

  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (selected.size === 0 || !newStatus) return
    const ids = Array.from(selected)
    await Promise.all(
      ids.map((id) =>
        fetch(`${API_URL}/api/jobs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        })
      )
    )
    setSelected(new Set())
    setShowModePicker(false)
    mutate()
  }, [selected, mutate])

  const clearFilters = useCallback(() => {
    setStatusFilter('')
    setSourceFilter('')
    setApplyTypeFilter('')
    setSearchFilter('')
    setSelected(new Set())
    setPage(0)
  }, [])

  const hasActiveFilters = Boolean(sourceFilter || applyTypeFilter || searchFilter)

  return (
    <>
    <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs
        value={statusFilter}
        onChange={(_, v) => {
          setStatusFilter(String(v))
          setSelected(new Set())
          setPage(0)
        }}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          px: 2.5,
          minHeight: 48,
          boxShadow: (t) => `inset 0 -2px 0 0 ${alpha(t.palette.grey[500], 0.08)}`,
        }}
      >
        <Tab
          value=""
          label="Todas"
          icon={
            <Chip
              label={statusCounts[''] ?? 0}
              size="small"
              sx={{ ml: 0.5, height: 20, fontSize: '0.75rem', fontWeight: 700 }}
            />
          }
          iconPosition="end"
          sx={{ textTransform: 'none', fontWeight: 600, minHeight: 48 }}
        />
        {ALL_STATUSES.map((s) => (
          <Tab
            key={s}
            value={s}
            label={STATUS_LABELS[s] || s}
            icon={
              <Chip
                label={statusCounts[s] ?? 0}
                size="small"
                color={STATUS_CHIP_COLOR[s] || 'default'}
                sx={{ ml: 0.5, height: 20, fontSize: '0.75rem', fontWeight: 700 }}
              />
            }
            iconPosition="end"
            sx={{ textTransform: 'none', fontWeight: 600, minHeight: 48 }}
          />
        ))}
      </Tabs>

      <Stack direction="row" spacing={1.5} sx={{ px: 2.5, py: 2, alignItems: 'center' }}>
        <TextField
          value={searchFilter}
          onChange={(e) => {
            setSearchFilter(e.target.value)
            setPage(0)
          }}
          placeholder="Buscar por titulo..."
          size="small"
          sx={{ width: 260 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                </InputAdornment>
              ),
            },
          }}
        />

        <Select
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value)
            setPage(0)
          }}
          displayEmpty
          size="small"
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">Todas origens</MenuItem>
          <MenuItem value="indeed">Indeed</MenuItem>
          <MenuItem value="linkedin">LinkedIn</MenuItem>
        </Select>

        <Select
          value={applyTypeFilter}
          onChange={(e) => {
            setApplyTypeFilter(e.target.value)
            setPage(0)
          }}
          displayEmpty
          size="small"
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">Todos tipos</MenuItem>
          <MenuItem value="easy_apply">Indeed Apply</MenuItem>
          <MenuItem value="external">Externo</MenuItem>
        </Select>

        <Box sx={{ flex: 1 }} />

        {hasActiveFilters && (
          <Tooltip title="Limpar filtros">
            <IconButton size="small" onClick={clearFilters} color="error">
              <FilterListOffIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        <Button
          size="small"
          variant="contained"
          startIcon={<CloudDownloadIcon />}
          onClick={() => setScrapeOpen(true)}
        >
          Coletar Vagas
        </Button>
      </Stack>

      {hasActiveFilters && (
        <Stack
          direction="row"
          alignItems="center"
          sx={(t) => ({
            px: 2.5,
            py: 1,
            bgcolor: alpha(t.palette.info.main, 0.08),
          })}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            <strong>{sortedJobs.length}</strong>&nbsp;resultados encontrados
          </Typography>
          <Button size="small" color="error" onClick={clearFilters} startIcon={<FilterListOffIcon />}>
            Limpar
          </Button>
        </Stack>
      )}

      <Box sx={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {selected.size > 0 && (
          <Card
            sx={(t) => ({
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              bgcolor: t.palette.primary.main,
              color: t.palette.primary.contrastText,
              borderRadius: 0,
              boxShadow: `0 4px 12px ${alpha(t.palette.primary.main, 0.4)}`,
            })}
          >
            <Stack direction="row" alignItems="center" sx={{ height: 56, pl: 1, pr: 2 }}>
              <Checkbox
                indeterminate={selected.size > 0 && !allSelected}
                checked={allSelected}
                onChange={toggleAll}
                size="small"
                sx={{ color: 'inherit', '&.Mui-checked': { color: 'inherit' }, '&.MuiCheckbox-indeterminate': { color: 'inherit' } }}
              />
              <Typography variant="subtitle2" sx={{ ml: 0.5, color: 'inherit' }}>
                {selected.size} selecionada{selected.size > 1 ? 's' : ''}
              </Typography>

              <Box sx={{ flex: 1 }} />

              <Select
                size="small"
                displayEmpty
                value=""
                onChange={(e) => handleStatusChange(e.target.value)}
                sx={{
                  mr: 1,
                  minWidth: 140,
                  color: 'inherit',
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#fff', 0.4) },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha('#fff', 0.7) },
                  '& .MuiSvgIcon-root': { color: 'inherit' },
                }}
              >
                <MenuItem value="" disabled>Mudar status</MenuItem>
                {ALL_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{STATUS_LABELS[s] || s}</MenuItem>
                ))}
              </Select>

              {showModePicker ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <FormControlLabel
                    control={<Checkbox size="small" checked={generateCv} onChange={(e) => setGenerateCv(e.target.checked)} sx={{ color: 'inherit', '&.Mui-checked': { color: 'inherit' } }} />}
                    label={<Typography variant="caption" sx={{ color: 'inherit' }}>Gerar CV</Typography>}
                  />
                  <Button size="small" variant="outlined" disabled={applying} onClick={() => handleApply('semi-auto')} sx={{ color: 'inherit', borderColor: alpha('#fff', 0.5), '&:hover': { borderColor: '#fff' } }}>
                    {applying ? <CircularProgress size={14} color="inherit" /> : 'Revisar'}
                  </Button>
                  <Button size="small" variant="outlined" disabled={applying} onClick={() => handleApply('full-auto')} sx={{ color: 'inherit', borderColor: alpha('#fff', 0.5), '&:hover': { borderColor: '#fff' } }}>
                    {applying ? <CircularProgress size={14} color="inherit" /> : 'Auto'}
                  </Button>
                  <IconButton size="small" onClick={() => setShowModePicker(false)} sx={{ color: 'inherit' }}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ) : (
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" startIcon={<SendIcon />} onClick={() => setShowModePicker(true)} sx={{ color: 'inherit', borderColor: alpha('#fff', 0.5), '&:hover': { borderColor: '#fff' } }}>
                    Aplicar
                  </Button>
                  <Button size="small" variant="outlined" startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteIcon />} disabled={deleting} onClick={handleDelete} sx={{ color: 'inherit', borderColor: alpha('#fff', 0.5), '&:hover': { borderColor: '#fff' } }}>
                    Excluir
                  </Button>
                </Stack>
              )}

              <IconButton size="small" sx={{ ml: 1, color: 'inherit' }} onClick={() => { setSelected(new Set()); setShowModePicker(false) }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Card>
        )}

        <TableContainer sx={{ height: '100%', overflow: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selected.size > 0 && !allSelected}
                    checked={allSelected}
                    onChange={toggleAll}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'title'}
                    direction={sortField === 'title' ? sortDir : 'asc'}
                    onClick={() => handleSort('title')}
                  >
                    Titulo
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'company'}
                    direction={sortField === 'company' ? sortDir : 'asc'}
                    onClick={() => handleSort('company')}
                  >
                    Empresa
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'location'}
                    direction={sortField === 'location' ? sortDir : 'asc'}
                    onClick={() => handleSort('location')}
                  >
                    Localizacao
                  </TableSortLabel>
                </TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'score'}
                    direction={sortField === 'score' ? sortDir : 'asc'}
                    onClick={() => handleSort('score')}
                  >
                    Score
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'status'}
                    direction={sortField === 'status' ? sortDir : 'asc'}
                    onClick={() => handleSort('status')}
                  >
                    Situacao
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'updatedAt'}
                    direction={sortField === 'updatedAt' ? sortDir : 'asc'}
                    onClick={() => handleSort('updatedAt')}
                  >
                    Data
                  </TableSortLabel>
                </TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {paginatedJobs.map((job) => {
                const id = Number(job.id)
                const checked = selected.has(id)
                const status = String(job.status ?? '')
                return (
                  <TableRow
                    key={id}
                    hover
                    selected={checked}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => toggleOne(id)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox checked={checked} size="small" />
                    </TableCell>
                    <TableCell>
                      <Typography
                        component={Link}
                        to={`/jobs/${String(job.id)}`}
                        variant="body2"
                        sx={{
                          color: 'text.primary',
                          textDecoration: 'none',
                          fontWeight: 600,
                          '&:hover': { textDecoration: 'underline' },
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {String(job.title || 'Sem titulo')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {String(job.company || '—')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {String(job.location || '—')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {job.applyType
                          ? (APPLY_TYPE_LABELS[String(job.applyType)] || String(job.applyType))
                          : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {job.score != null ? String(job.score) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={STATUS_LABELS[status] || status}
                        color={STATUS_CHIP_COLOR[status] || 'default'}
                        size="small"
                        variant="filled"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {String(job.updatedAt || '').slice(0, 10)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )
              })}

              {paginatedJobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 8, textAlign: 'center' }}>
                    <Typography color="text.secondary">Nenhuma vaga encontrada</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <TablePagination
        component="div"
        count={sortedJobs.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10))
          setPage(0)
        }}
        rowsPerPageOptions={[10, 25, 50, 100]}
        labelRowsPerPage="Linhas por pagina:"
        labelDisplayedRows={({ from, to, count: c }) => `${from}–${to} de ${c}`}
        sx={{
          borderTop: (t) => `1px solid ${alpha(t.palette.grey[500], 0.12)}`,
          flexShrink: 0,
        }}
      />
    </Card>

    <Dialog open={scrapeOpen} onClose={() => { setScrapeOpen(false); setScrapeResult(null) }} maxWidth="md" fullWidth>
      <DialogTitle>Coletar Vagas</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            {PLATFORMS.map((p) => (
              <Chip
                key={p.id}
                label={p.label}
                variant="filled"
                color={p.available ? 'primary' : 'default'}
                disabled={!p.available}
                sx={{ fontWeight: 600, opacity: p.available ? 1 : 0.4 }}
              />
            ))}
          </Stack>

          <Divider />

          <Stack direction="row" spacing={2} alignItems="center">
            <TextField
              size="small"
              type="number"
              label="Idade max (horas)"
              value={searches[0]?.hoursOld ?? 72}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 72
                setSearches((prev) => prev.map((s) => ({ ...s, hoursOld: v })))
              }}
              slotProps={{ htmlInput: { min: 1 } }}
              sx={{ width: 150 }}

            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={searches[0]?.easyApplyOnly ?? false}
                  onChange={(e) => {
                    const v = e.target.checked
                    setSearches((prev) => prev.map((s) => ({ ...s, easyApplyOnly: v })))
                  }}
                />
              }
              label={<Typography variant="body2">Somente Easy Apply</Typography>}
            />
          </Stack>

          <Divider />

          {searches.map((s, idx) => (
            <Stack key={idx} direction="row" spacing={1.5} alignItems="center">
              <TextField size="small" placeholder="react OR nodejs OR typescript" label="Palavras-chave" value={s.query} onChange={(e) => setSearches((prev) => prev.map((r, i) => i === idx ? { ...r, query: e.target.value } : r))} sx={{ flex: 1 }} />
              <TextField size="small" placeholder="Brasil" label="Localizacao" value={s.location} onChange={(e) => setSearches((prev) => prev.map((r, i) => i === idx ? { ...r, location: e.target.value } : r))} sx={{ width: 150 }} />
              <TextField size="small" type="number" label="Max" value={s.maxResults} onChange={(e) => setSearches((prev) => prev.map((r, i) => i === idx ? { ...r, maxResults: parseInt(e.target.value) || 50 } : r))} slotProps={{ htmlInput: { min: 1, max: 500 } }} sx={{ width: 80 }} />
              {searches.length > 1 && (
                <IconButton size="small" onClick={() => setSearches((prev) => prev.filter((_, i) => i !== idx))} sx={{ color: 'error.main' }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          ))}

          <Button size="small" startIcon={<AddIcon />} onClick={() => setSearches((prev) => [...prev, { ...DEFAULT_SEARCH }])} sx={{ alignSelf: 'flex-start' }}>
            Adicionar busca
          </Button>

          {scrapeResult && (
            <Alert severity={scrapeResult.newJobs > 0 ? 'success' : 'info'}>
              {scrapeResult.newJobs > 0 ? `${scrapeResult.newJobs} novas vagas coletadas` : 'Nenhuma vaga nova encontrada'}
              {scrapeResult.skipped > 0 && ` · ${scrapeResult.skipped} duplicadas`}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => { setScrapeOpen(false); setScrapeResult(null) }} color="inherit">Fechar</Button>
        <Button variant="contained" disabled={scraping || searches.every((s) => !s.query.trim())} onClick={handleScrape} startIcon={scraping ? <CircularProgress size={16} color="inherit" /> : undefined}>
          Coletar
        </Button>
      </DialogActions>
    </Dialog>
    </>
  )
}
