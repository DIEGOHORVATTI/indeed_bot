# Indeed Auto-Apply Bot

Bot que aplica automaticamente em vagas do Indeed com "Candidatura Simplificada" (Indeed Apply).

> **Aviso:** Use por sua conta e risco. O Indeed pode alterar o site ou adicionar proteções anti-bot a qualquer momento.

---

## Features

- Aplica automaticamente em vagas com "Indeed Apply" via [Camoufox](https://github.com/daijro/camoufox)
- CV e carta de apresentação personalizados por vaga (via Claude CLI)
- Upload de currículo via API do smartapply (fallback: UI click + file input)
- Questionários preenchidos automaticamente (respostas padrão + cache + Claude CLI)
- Detecção de vagas externas (redireciona para site da empresa) — pula automaticamente
- Registro persistente de vagas aplicadas/puladas (`job_registry.json`) — nunca aplica duas vezes
- Verificação pós-aplicação via `myjobs.indeed.com/applied`
- Suporte multi-idioma (BR, EN, FR, DE, ES)
- Respostas padrão configuráveis:
  - PCD/Deficiência → Não
  - Modelo de contratação → PJ
  - Pretensão salarial → baseada no nível da vaga (Junior 3k, Pleno 9k, Sênior 14k)
- Cache de respostas de questionários (`answer_cache.json`) — acumula entre execuções

---

## Pré-requisitos

- Python 3.9+
- [uv](https://github.com/astral-sh/uv) (recomendado) ou pip
- Conta no Indeed com CV já carregado e perfil preenchido (nome, endereço, telefone)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) instalado (para personalização e respostas inteligentes)

---

## Setup

1. **Clone e instale:**

    ```bash
    git clone https://github.com/DIEGOHORVATTI/indeed_bot.git
    cd indeed_bot
    uv sync
    ```

2. **Configure `config.yaml`:**

    ```yaml
    profile:
      name: 'Seu Nome'
      email: 'email@example.com'
      phone: '+55 00 000000000'
      location: 'Cidade, Estado, País'
      linkedin: 'https://linkedin.com/in/seu-perfil'
      github: 'https://github.com/seu-user'

    search:
      # Opção A: múltiplas URLs de busca
      base_urls:
        - 'https://br.indeed.com/jobs?q=full+stack&l=Florianópolis&fromage=7&radius=100'
        - 'https://br.indeed.com/jobs?q=nodejs&l=Brasil&sc=0kf%3Aattr%28DSQF7%29%3B'

      # Opção B: URL única com paginação
      base_url: 'https://br.indeed.com/jobs?q=full+stack&l=Florianópolis'
      start: 0
      end: 100

    camoufox:
      user_data_dir: 'user_data_dir'
      language: 'br'  # br, us, uk, fr, de, es

    personalization:
      enabled: true
      base_cv_path: 'assets/base_cv.md'
      base_cover_letter_path: 'assets/base_cover_letter.md'
      claude_cli_path: 'claude'
      output_dir: 'output'
    ```

    | Campo | Descrição |
    |---|---|
    | `profile` | Dados pessoais usados nos templates de CV/carta |
    | `base_urls` | Lista de URLs de busca (prioridade sobre `base_url`) |
    | `base_url` | URL única, paginada com `start`/`end` |
    | `language` | Código do Indeed (`br`, `us`, `uk`, `fr`, `de`) |
    | `user_data_dir` | Diretório do perfil do browser (mantém sessão de login) |
    | `personalization.enabled` | Gera CV/carta personalizados por vaga via Claude |

3. **Como pegar a URL de busca:**

    - Vá no [Indeed](https://www.indeed.com/)
    - Configure seus filtros (cargo, localização, remoto, data, etc.)
    - Clique em **Buscar vagas**
    - Copie a URL da barra de endereço
    - Cole no `config.yaml`

---

## Uso

```bash
# Modo full (coleta tudo, depois aplica)
uv run python -m app

# Modo minimal (coleta e aplica por página — mais rápido para testar)
uv run python -m app --mode minimal

# Limitar número de aplicações
uv run python -m app --max 10

# Testar com 1 vaga
uv run python -m app --max 1 --mode minimal

# Config customizado
uv run python -m app --config meu_config.yaml
```

| Flag | Descrição |
|---|---|
| `--mode full` | Coleta todas as vagas primeiro, depois aplica (padrão) |
| `--mode minimal` | Coleta e aplica por página (mais rápido) |
| `--max N` | Máximo de aplicações (padrão: ilimitado) |
| `--config PATH` | Caminho do config.yaml (padrão: `config.yaml`) |

---

## Primeira execução

1. Rode o bot:
    ```bash
    uv run python -m app --max 1
    ```
2. O browser abre na página de login do Indeed
3. Faça login manualmente
4. O bot detecta o cookie de sessão e continua automaticamente
5. A sessão é salva em `user_data_dir/` para as próximas execuções

---

## Como funciona

### Fluxo de aplicação

1. **Busca** — Navega pelas páginas de resultados e coleta links de vagas com "Indeed Apply"
2. **Validação** — Verifica se a URL é do Indeed, pula vagas externas e já aplicadas
3. **Personalização** — Gera CV e carta de apresentação personalizados via Claude CLI
4. **Wizard** — Detecta o iframe do smartapply e navega pelo formulário:
   - Upload de currículo (file input → UI click → API `/api/v1/files` → fallback)
   - Preenchimento de questionários (padrões → cache → Claude CLI)
   - Clica Continue/Submit em cada etapa
5. **Verificação** — Confirma a aplicação em `myjobs.indeed.com/applied`
6. **Registro** — Salva resultado em `job_registry.json`

### Respostas automáticas de questionários

Ordem de prioridade:
1. **Respostas padrão** — PCD→Não, Contratação→PJ, Salário→por nível
2. **Cache** (`answer_cache.json`) — respostas dadas anteriormente para perguntas similares
3. **Claude CLI** — pergunta ao Claude e salva a resposta no cache

O cache é persistente e acumula entre execuções. Quanto mais rodar, menos chamadas ao Claude.

---

## Estrutura do projeto

```
indeed_bot/
├── app/
│   ├── __main__.py            # Entrypoint: python -m app
│   ├── cli.py                 # CLI (argparse)
│   ├── bot.py                 # IndeedBot (orquestrador)
│   ├── models/
│   │   └── config.py          # Modelos Pydantic de configuração
│   ├── services/
│   │   ├── browser.py         # Setup do Camoufox + proxy
│   │   ├── cv_generator.py    # Scraping de vagas + chamadas ao Claude CLI
│   │   ├── pdf.py             # Templates HTML → PDF (Playwright)
│   │   ├── answer_cache.py    # Cache de respostas de questionários
│   │   └── job_registry.py    # Registro persistente de vagas aplicadas/puladas
│   └── utils/
│       ├── indeed.py          # Coleta de links, aplicação, wizard, questionários
│       ├── login.py           # Detecção de cookie de sessão
│       ├── logger.py          # Logger dual (arquivo + console)
│       ├── pagination.py      # Paginação de URLs
│       └── selectors.py       # Helpers DOM (find_first, click_first, find_all)
├── assets/
│   ├── base_cv.md             # CV base em markdown
│   ├── base_cover_letter.md   # Carta de apresentação base
│   ├── cv_template.html       # Template HTML do CV
│   └── cover_template.html    # Template HTML da carta
├── config.yaml                # Configuração do usuário
├── answer_cache.json          # Cache de respostas (persistente)
├── job_registry.json          # Registro de vagas (persistente)
└── pyproject.toml             # Dependências e metadata
```

---

## Troubleshooting

| Problema | Solução |
|---|---|
| Bot não aplica / fica preso | Veja `indeed_apply.log` para erros |
| Login não detectado | Delete `user_data_dir/` e rode novamente |
| CV não é gerado | Verifique se `claude` CLI está instalado e no PATH |
| Captcha aparece | Resolva manualmente no browser; o bot espera e continua |
| Vaga é pulada com "external_apply" | Correto — a vaga redireciona para site externo |

---

## Disclaimer

Este projeto não é afiliado ao Indeed. Use por sua conta e risco.

## License

MIT — veja [LICENSE](LICENSE).
