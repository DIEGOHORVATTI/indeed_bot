import { useState, useEffect, useCallback } from 'react'
import { API_URL } from '@/lib/api'

export default function SettingsPage() {
  const [profile, setProfile] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/api/settings/profile`)
      .then((r) => r.json())
      .then((data: { value?: string }) => setProfile(data.value || ''))
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

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-2xl font-bold text-foreground">Perfil</h2>
      <p className="text-sm text-muted-foreground">
        Escreva tudo sobre você: nome, e-mail, telefone, localização, links,
        experiência, educação, habilidades, idiomas. A IA vai extrair o que
        precisar para preencher formulários e gerar CVs.
      </p>

      <div className="bg-card rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-card-foreground">
            Seu Perfil
          </label>
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
        <textarea
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder={`Diego Horvatti
diego@email.com
+55 11 99999-9999
São Paulo, Brazil

LinkedIn: https://linkedin.com/in/diegohorvatti
GitHub: https://github.com/diegohorvatti
Portfolio: https://diegohorvatti.dev

## Summary
Senior Full Stack Developer with 6+ years of experience...

## Experience
**Senior Developer** — Company X (2022-Present)
- Built microservices architecture using Node.js, TypeScript
- Led migration from monolith to event-driven architecture
...

## Education
Computer Science — University ABC (2018-2022)

## Skills
TypeScript, React, Node.js, Python, PostgreSQL, Redis, Docker, AWS

## Languages
Portuguese (native), English (fluent), Spanish (intermediate)

## Additional
CPF: 123.456.789-00
RG: 12.345.678-9
Birth date: 1995-03-15`}
          rows={30}
          spellCheck={false}
          className="w-full bg-background border border-input rounded-lg p-4 text-sm text-card-foreground font-mono resize-y focus:outline-none focus:border-accent focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
      </div>
    </div>
  )
}
