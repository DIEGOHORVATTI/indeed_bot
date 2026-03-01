# Indeed Auto-Apply — Chrome Extension

Extensão Chrome que aplica automaticamente em vagas do Indeed com "Candidatura Simplificada" (Indeed Apply).

> **Aviso:** Use por sua conta e risco. O Indeed pode alterar o site ou adicionar proteções a qualquer momento.

---

## Features

- Aplica automaticamente em vagas com "Indeed Apply" direto do navegador
- CV e carta de apresentação personalizados por vaga (via Claude CLI no backend)
- Upload de currículo no SmartApply (React file input + fallback)
- Questionários preenchidos automaticamente (respostas padrão + cache + Claude)
- Detecção de vagas externas — pula automaticamente
- Registro persistente de vagas aplicadas/puladas — nunca aplica duas vezes
- Suporte multi-idioma (BR, EN, FR, DE, ES)

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) (para build da extensão)
- Python 3.9+ e [uv](https://github.com/astral-sh/uv) (para o backend)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) instalado (usado pelo backend)
- Conta no Indeed com perfil preenchido

---

## Setup

1. **Clone e instale:**

    ```bash
    git clone https://github.com/DIEGOHORVATTI/indeed_bot.git
    cd indeed_bot
    uv sync
    cd apps/extension && npm install
    ```

2. **Build da extensão:**

    ```bash
    cd apps/extension
    npm run build
    ```

3. **Carregue no Chrome:**
    - Acesse `chrome://extensions/`
    - Ative **Modo do desenvolvedor**
    - Clique **Carregar sem compactação** e selecione a pasta `apps/extension/dist`

4. **Configure a extensão:**
    - Clique no ícone da extensão → **Options**
    - Preencha seus dados pessoais, URL do backend, e currículo base

---

## Backend

Servidor FastAPI que faz proxy das chamadas ao Claude CLI. A extensão se comunica com ele para respostas inteligentes e geração de PDF.

```bash
uv run uvicorn apps.backend.server:app --host 0.0.0.0 --port 3000
```

| Endpoint | Método | Descrição |
|---|---|---|
| `/health` | GET | Health check |
| `/api/answer` | POST | Responde perguntas de formulário via Claude CLI |
| `/api/tailor` | POST | Gera CV e carta de apresentação personalizados |
| `/api/generate-pdf` | POST | Converte HTML para PDF |

---

## Estrutura do projeto

```
indeed_bot/
├── apps/
│   ├── backend/
│   │   ├── server.py            # FastAPI (proxy Claude CLI)
│   │   └── pdf.py               # HTML → PDF (Playwright)
│   └── extension/
│       ├── src/
│       │   ├── background/      # Service worker + orquestrador
│       │   ├── content/         # Content scripts (isolated + main world)
│       │   ├── popup/           # Popup UI
│       │   ├── options/         # Página de configuração
│       │   ├── services/        # Claude, PDF, cache, job registry
│       │   └── utils/           # Selectors, i18n, notifications
│       ├── manifest.json
│       └── webpack.config.js
└── pyproject.toml
```

---

## Troubleshooting

| Problema | Solução |
|---|---|
| Extensão não conecta ao backend | Verifique se o backend está rodando e a URL está correta nas options |
| CV não é gerado | Verifique se `claude` CLI está instalado e no PATH |
| Vaga é pulada | Pode ser vaga externa (redireciona para site da empresa) ou já aplicada |

---

## Disclaimer

Este projeto não é afiliado ao Indeed. Use por sua conta e risco.

## License

MIT — veja [LICENSE](LICENSE).
