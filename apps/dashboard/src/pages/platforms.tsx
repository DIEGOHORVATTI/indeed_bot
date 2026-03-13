import { useState, useEffect, useCallback } from 'react'
import { API_URL } from '@/lib/api'

interface PlatformOption {
  id: string
  name: string
  description: string
  available: boolean
}

const PLATFORMS: PlatformOption[] = [
  {
    id: 'indeed',
    name: 'Indeed',
    description: 'Maior portal de vagas do mundo. Suporte para Brasil, EUA e vários países.',
    available: true,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Rede profissional com anúncios de vagas. Requer login.',
    available: false,
  },
  {
    id: 'glassdoor',
    name: 'Glassdoor',
    description: 'Portal de vagas com avaliações de empresas e dados salariais.',
    available: false,
  },
  {
    id: 'google_jobs',
    name: 'Google Jobs',
    description: 'Agrega vagas de múltiplas fontes via Google Search.',
    available: false,
  },
]

export default function PlatformsPage() {
  const [enabled, setEnabled] = useState<string[]>(['indeed'])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/api/settings/platforms`)
      .then((r) => r.json())
      .then((data: { value?: string }) => {
        if (!data.value) return
        try {
          const parsed = JSON.parse(data.value)
          if (Array.isArray(parsed)) setEnabled(parsed)
        } catch { /* empty */ }
      })
      .catch(() => {})
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`${API_URL}/api/settings/platforms`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(enabled) }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [enabled])

  const toggle = (id: string) => {
    setEnabled((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Plataformas</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Selecione em quais plataformas buscar e candidatar-se.
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLATFORMS.map((platform) => {
          const isEnabled = enabled.includes(platform.id)
          return (
            <button
              key={platform.id}
              onClick={() => platform.available && toggle(platform.id)}
              disabled={!platform.available}
              className={`text-left rounded-lg p-5 border transition-colors ${
                !platform.available
                  ? 'bg-card/50 border-border/50 opacity-50 cursor-not-allowed'
                  : isEnabled
                    ? 'bg-card border-accent'
                    : 'bg-card border-border hover:border-input'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-card-foreground">{platform.name}</span>
                {!platform.available ? (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    Em breve
                  </span>
                ) : (
                  <div
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                      isEnabled
                        ? 'border-accent bg-accent'
                        : 'border-input'
                    }`}
                  >
                    {isEnabled && (
                      <svg className="w-3 h-3 text-accent-foreground" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{platform.description}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
