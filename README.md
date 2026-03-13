# JobPilot

Monorepo TypeScript para automacao de candidaturas — extensao Chrome, pipeline de IA e dashboard em tempo real.

> **Aviso:** Use por sua conta e risco. Sites de emprego podem alterar sua estrutura ou adicionar protecoes a qualquer momento.

---

## Arquitetura

```
jobpilot/
├── packages/
│   ├── types/            @jobpilot/types     — interfaces compartilhadas
│   ├── config/           @jobpilot/config    — variaveis de ambiente, loaders de perfil/busca
│   ├── ai-provider/      @jobpilot/ai        — Anthropic SDK + Claude CLI
│   ├── db/               @jobpilot/db        — drizzle + SQLite (bun:sqlite)
│   ├── pdf/              @jobpilot/pdf       — Playwright HTML→PDF + renderizacao de templates
│   └── anti-detection/   @jobpilot/anti-detection — delays, rate limits, rotacao de UA
│
├── apps/
│   ├── api/              @jobpilot/api       — Elysia server (backend da extensao + API do dashboard)
│   ├── worker/           @jobpilot/worker    — BullMQ pipeline (6 estagios + browser agent)
│   ├── dashboard/        @jobpilot/dashboard — Vite + React (monitoramento em tempo real)
│   └── extension/        Extensao Chrome     — SmartApply wizard, preenchimento de formularios
│
└── templates/            Templates HTML de CV + carta de apresentacao
```

### Estagios do Pipeline

```
discover → enrich → score → tailor → render-pdf → apply
   │         │        │        │         │           │
   │         │        │        │         │           └─ Browser agent stealth via Playwright
   │         │        │        │         └─ Preenchimento de template HTML + geracao de PDF
   │         │        │        └─ Claude Opus personaliza CV/carta por vaga
   │         │        └─ Claude Haiku pontua compatibilidade vaga-candidato (0-100)
   │         └─ Busca descricao completa (JSON-LD → meta → CSS → body)
   └─ Coleta resultados de busca (Indeed, LinkedIn, etc.)
```

---

## Pre-requisitos

- [Bun](https://bun.sh/) v1.3+
- [Docker](https://www.docker.com/) (para Redis)
- `ANTHROPIC_API_KEY` ou [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli)
- Conta no Indeed / LinkedIn

---

## Inicio Rapido

```bash
git clone https://github.com/DIEGOHORVATTI/job-pilot.git
cd job-pilot

# Instalar dependencias
bun install

# Instalar browsers do Playwright
bunx playwright install chromium

# Configurar ambiente
cp .env.example .env
# Edite .env com sua ANTHROPIC_API_KEY

# Iniciar Redis
docker compose up -d redis

# Executar migracoes do banco
bun run db:migrate

# Iniciar todos os servicos
./start.sh
```

### Servicos Individuais

```bash
bun run dev:api        # Elysia API em :8004
bun run dev:worker     # BullMQ pipeline workers
bun run dev:dashboard  # Vite + React dashboard em :8005
```

### Extensao

```bash
cd apps/extension
bun install
bun run build
```

1. Acesse `chrome://extensions/` → ative o **Modo desenvolvedor**
2. Clique em **Carregar sem compactacao** → selecione `apps/extension/dist`
3. Clique no icone da extensao → configure a URL do backend

> As configuracoes da extensao (perfil, buscas, plataformas) sao gerenciadas pelo dashboard.

---

## Variaveis de Ambiente

| Variavel | Padrao | Descricao |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Obrigatoria para o provedor de IA |
| `AI_PROVIDER` | `api` | `"api"` (Anthropic SDK) ou `"cli"` (Claude CLI) |
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-4-5-20251001` | Modelo rapido (respostas de formulario, scoring) |
| `ANTHROPIC_MODEL_SMART` | `claude-opus-4-20250514` | Modelo inteligente (personalizacao de CV) |
| `REDIS_URL` | `redis://localhost:6379` | Conexao Redis para BullMQ |
| `DATA_DIR` | `./data` | Banco SQLite e PDFs |
| `PORT` | `8004` | Porta do servidor API |
| `DASHBOARD_PORT` | `8005` | Porta do dashboard |
| `PROXY_URL` | — | Proxy HTTP/SOCKS para requisicoes do worker |

---

## Referencia da API

URL base: `http://localhost:8004`

### Rotas da Extensao

| Metodo | Endpoint | Descricao |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/answer` | Resposta de campo de formulario via IA |
| `POST` | `/api/tailor` | Gera CV + carta personalizados (JSON) |
| `POST` | `/api/generate-pdf` | HTML → PDF via Playwright |
| `GET` | `/api/pdf/:filename` | Recuperar PDF salvo |
| `WS` | `/ws` | WebSocket bridge (extensao ↔ backend) |

### Rotas do Dashboard

| Metodo | Endpoint | Descricao |
|---|---|---|
| `GET` | `/api/jobs?status=&limit=` | Listar vagas com filtro opcional |
| `GET` | `/api/jobs/stats` | Contagens agrupadas por status |
| `GET` | `/api/jobs/:id` | Detalhe da vaga |
| `PATCH` | `/api/jobs/:id` | Atualizar campos da vaga |
| `POST` | `/api/pipeline/start` | Iniciar discover → pipeline |
| `POST` | `/api/pipeline/stop` | Drenar todas as filas |
| `GET` | `/api/pipeline/status` | Profundidade das filas + contagens ativas |
| `GET` | `/api/settings` | Obter configuracoes |
| `PUT` | `/api/settings` | Atualizar configuracoes |

### Rotas de Curriculos

| Metodo | Endpoint | Descricao |
|---|---|---|
| `GET` | `/api/cvs` | Listar todos os CVs |
| `GET` | `/api/cvs/:id` | Detalhe do CV |
| `POST` | `/api/cvs` | Criar CV manualmente |
| `POST` | `/api/cvs/generate` | Gerar CV via IA (com template + prompt) |
| `POST` | `/api/cvs/:id/score` | Incrementar score do CV |
| `DELETE` | `/api/cvs/:id` | Excluir CV |

---

## Scripts

| Comando | Descricao |
|---|---|
| `bun run build` | Build de todos os pacotes e apps (via Turbo) |
| `bun run dev` | Modo dev para todos os servicos |
| `bun run dev:api` | Apenas servidor API |
| `bun run dev:worker` | Apenas pipeline workers |
| `bun run dev:dashboard` | Apenas dashboard |
| `bun run db:migrate` | Executar migracoes drizzle |
| `bun run clean` | Remover todos os outputs de build |
| `./start.sh` | Inicia Redis + API + Worker + Dashboard |

---

## Stack Tecnologica

| Camada | Tecnologia |
|---|---|
| Monorepo | Turborepo + Bun workspaces |
| API | Elysia + WebSocket |
| Fila | BullMQ + Redis |
| Banco de Dados | SQLite via bun:sqlite + drizzle-orm |
| IA | @anthropic-ai/sdk (Claude Haiku + Opus) |
| PDF | Playwright `page.pdf()` |
| Stealth | playwright-extra + puppeteer-extra-plugin-stealth |
| Dashboard | Vite + React + React Router + Tailwind CSS + SWR |
| Extensao | Chrome MV3 + webpack + TypeScript |

---

## Resolucao de Problemas

| Problema | Solucao |
|---|---|
| Extensao nao conecta | Verifique se a API esta rodando em `:8004` e a URL esta correta nas opcoes |
| CV nao gerado | Verifique se `ANTHROPIC_API_KEY` esta definida no `.env` |
| Vagas ignoradas no scoring | Diminua `scoreThreshold` nas buscas (padrao: 40) |
| Falha na geracao de PDF | Execute `bunx playwright install chromium` |
| Conexao Redis recusada | Execute `docker compose up -d redis` |
| Worker nao processa | Verifique se Redis esta rodando e `REDIS_URL` esta correta |

---

## Licenca

MIT — veja [LICENSE](LICENSE).
