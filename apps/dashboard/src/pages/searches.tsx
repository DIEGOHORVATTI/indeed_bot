import { useState, useEffect, useCallback } from 'react'
import { API_URL } from '@/lib/api'

interface SearchRow {
  query: string
  location: string
  hoursOld: number
  resultsWanted: number
  country: string
}

const emptyRow: SearchRow = {
  query: '',
  location: '',
  hoursOld: 72,
  resultsWanted: 30,
  country: 'Brazil',
}

export default function SearchesPage() {
  const [rows, setRows] = useState<SearchRow[]>([{ ...emptyRow }])
  const [scoreThreshold, setScoreThreshold] = useState(40)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [applyMode, setApplyMode] = useState<'all' | 'easy_apply' | 'external'>('all')
  const [priorityOrder, setPriorityOrder] = useState<'easy_first' | 'external_first' | 'score_first'>('easy_first')
  const [scoreEasyApply, setScoreEasyApply] = useState(40)
  const [scoreExternal, setScoreExternal] = useState(60)
  const [limitEasyApply, setLimitEasyApply] = useState(0)
  const [limitExternal, setLimitExternal] = useState(0)
  const [platforms, setPlatforms] = useState({
    indeedEasyApply: true,
    linkedinEasyApply: true,
    workday: true,
    greenhouse: true,
    lever: true,
    otherExternal: true,
  })
  const [maxJobAge, setMaxJobAge] = useState(72)

  useEffect(() => {
    fetch(`${API_URL}/api/settings/searches`)
      .then((r) => r.json())
      .then((data: { value?: string }) => {
        if (!data.value) return
        try {
          const parsed = JSON.parse(data.value)
          if (parsed.searches?.length) setRows(parsed.searches)
          if (parsed.scoreThreshold != null) setScoreThreshold(parsed.scoreThreshold)
          if (parsed.applyMode) setApplyMode(parsed.applyMode)
          if (parsed.priorityOrder) setPriorityOrder(parsed.priorityOrder)
          if (parsed.scoreEasyApply != null) setScoreEasyApply(parsed.scoreEasyApply)
          if (parsed.scoreExternal != null) setScoreExternal(parsed.scoreExternal)
          if (parsed.limitEasyApply != null) setLimitEasyApply(parsed.limitEasyApply)
          if (parsed.limitExternal != null) setLimitExternal(parsed.limitExternal)
          if (parsed.platforms) setPlatforms((p) => ({ ...p, ...parsed.platforms }))
          if (parsed.maxJobAge != null) setMaxJobAge(parsed.maxJobAge)
        } catch { /* empty */ }
      })
      .catch(() => {})
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    const valid = rows.filter((r) => r.query.trim())
    try {
      await fetch(`${API_URL}/api/settings/searches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: JSON.stringify({
            searches: valid,
            scoreThreshold: Math.min(scoreEasyApply, scoreExternal),
            applyMode,
            priorityOrder,
            scoreEasyApply,
            scoreExternal,
            limitEasyApply,
            limitExternal,
            platforms,
            maxJobAge,
          }),
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [rows, scoreThreshold, applyMode, priorityOrder, scoreEasyApply, scoreExternal, limitEasyApply, limitExternal, platforms, maxJobAge])

  const updateRow = (i: number, field: keyof SearchRow, val: string | number) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)))
  }

  const addRow = () => setRows((prev) => [...prev, { ...emptyRow }])

  const removeRow = (i: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)))
  }

  const togglePlatform = (key: keyof typeof platforms) => {
    setPlatforms((p) => ({ ...p, [key]: !p[key] }))
  }

  const inputClass =
    'w-full bg-background border border-input rounded px-3 py-2 text-sm text-card-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-ring'

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Buscas</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure quais vagas buscar e onde.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-success">Salvo</span>}
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 bg-accent hover:bg-accent/80 rounded text-xs font-medium text-accent-foreground disabled:opacity-50 transition-colors"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="bg-card rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-card-foreground">
              Busca #{i + 1}
            </span>
            {rows.length > 1 && (
              <button
                onClick={() => removeRow(i)}
                className="text-xs text-destructive hover:text-destructive/80"
              >
                Remover
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Cargo / palavras-chave</label>
              <input
                type="text"
                value={row.query}
                onChange={(e) => updateRow(i, 'query', e.target.value)}
                placeholder="Desenvolvedor Frontend"
                className={`${inputClass} placeholder:text-muted-foreground/50`}
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Localização</label>
              <input
                type="text"
                value={row.location}
                onChange={(e) => updateRow(i, 'location', e.target.value)}
                placeholder="São Paulo"
                className={`${inputClass} placeholder:text-muted-foreground/50`}
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">País</label>
              <input
                type="text"
                value={row.country}
                onChange={(e) => updateRow(i, 'country', e.target.value)}
                placeholder="Brasil"
                className={`${inputClass} placeholder:text-muted-foreground/50`}
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Idade máxima do anúncio (horas)</label>
              <input
                type="number"
                value={row.hoursOld}
                onChange={(e) => updateRow(i, 'hoursOld', parseInt(e.target.value) || 72)}
                min={1}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Resultados por busca</label>
              <input
                type="number"
                value={row.resultsWanted}
                onChange={(e) => updateRow(i, 'resultsWanted', parseInt(e.target.value) || 30)}
                min={1}
                max={100}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={addRow}
        className="w-full py-2 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-input transition-colors"
      >
        + Adicionar busca
      </button>

      <div className="bg-card rounded-lg p-5 space-y-4">
        <span className="text-sm font-semibold text-card-foreground">Tipo de Aplicação</span>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Filtrar vagas por tipo</label>
            <div className="flex gap-1">
              {([['all', 'Todas'], ['easy_apply', 'Easy Apply'], ['external', 'External']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setApplyMode(val)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    applyMode === val
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Ordem de prioridade</label>
            <div className="flex gap-1">
              {([['easy_first', 'Easy Apply primeiro'], ['external_first', 'External primeiro'], ['score_first', 'Maior score primeiro']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setPriorityOrder(val)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    priorityOrder === val
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg p-5 space-y-4">
        <span className="text-sm font-semibold text-card-foreground">Pontuação Mínima por Tipo</span>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground block">Easy Apply — score mínimo</label>
            <input
              type="number"
              value={scoreEasyApply}
              onChange={(e) => setScoreEasyApply(parseInt(e.target.value) || 0)}
              min={0}
              max={100}
              className={`w-32 ${inputClass}`}
            />
            <p className="text-xs text-muted-foreground">
              Vagas Easy Apply com score abaixo deste valor serão ignoradas
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground block">External — score mínimo</label>
            <input
              type="number"
              value={scoreExternal}
              onChange={(e) => setScoreExternal(parseInt(e.target.value) || 0)}
              min={0}
              max={100}
              className={`w-32 ${inputClass}`}
            />
            <p className="text-xs text-muted-foreground">
              Vagas externas exigem score maior — são mais trabalhosas
            </p>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg p-5 space-y-4">
        <span className="text-sm font-semibold text-card-foreground">Limites Diários</span>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground block">Easy Apply por dia</label>
            <input
              type="number"
              value={limitEasyApply}
              onChange={(e) => setLimitEasyApply(parseInt(e.target.value) || 0)}
              min={0}
              className={`w-32 ${inputClass}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground block">External por dia</label>
            <input
              type="number"
              value={limitExternal}
              onChange={(e) => setLimitExternal(parseInt(e.target.value) || 0)}
              min={0}
              className={`w-32 ${inputClass}`}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">0 = sem limite</p>
      </div>

      <div className="bg-card rounded-lg p-5 space-y-4">
        <span className="text-sm font-semibold text-card-foreground">Plataformas</span>

        <div className="grid grid-cols-2 gap-4">
          {([
            ['indeedEasyApply', 'Indeed Easy Apply'],
            ['linkedinEasyApply', 'LinkedIn Easy Apply'],
            ['workday', 'Workday'],
            ['greenhouse', 'Greenhouse'],
            ['lever', 'Lever'],
            ['otherExternal', 'Outros sites externos'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={platforms[key]}
                onChange={() => togglePlatform(key)}
                className="w-4 h-4 rounded border-input accent-accent"
              />
              <span className="text-sm text-card-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-lg p-5 space-y-3">
        <span className="text-sm font-semibold text-card-foreground">Idade Máxima das Vagas</span>

        <div className="flex items-center gap-3">
          <input
            type="number"
            value={maxJobAge}
            onChange={(e) => setMaxJobAge(parseInt(e.target.value) || 72)}
            min={1}
            className={`w-32 ${inputClass}`}
          />
          <span className="text-sm text-muted-foreground">
            horas (= {Math.round((maxJobAge / 24) * 10) / 10} {maxJobAge / 24 === 1 ? 'dia' : 'dias'})
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Vagas publicadas há mais de X horas serão ignoradas. Use 24 para último dia, 72 para últimos 3 dias, 168 para última semana.
        </p>
      </div>
    </div>
  )
}
