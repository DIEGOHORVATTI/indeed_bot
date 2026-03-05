# Indeed Bot - Chrome Extension - Especificacoes e Regras de Negocio

> Documento para handoff de frontend para agencia. Contem TODAS as regras de negocio, fluxos, estados, constantes e decisoes de arquitetura da extensao Chrome.

---

## 1. Visao Geral

Extensao Chrome que automatiza candidaturas no Indeed. O usuario configura URLs de busca, perfil profissional e CV base. O bot coleta vagas, gera CV/carta de apresentacao personalizados via IA (Claude API) e preenche formularios automaticamente. O usuario revisa e clica nos botoes nativos do Indeed para avancar (modo human-review).

---

## 2. Arquitetura

### 2.1 Componentes

```
Chrome Extension (Frontend)
  |
  +-- Popup (UI de controle: start/pause/stop + status)
  +-- Options Page (configuracoes completas)
  +-- Content Scripts
  |     +-- indeed.ts → paginas de busca (indeed.com, EXCETO smartapply.indeed.com)
  |     +-- smartapply.ts → wizard de candidatura (smartapply.indeed.com, ISOLATED world)
  |     +-- mainworld.ts → bridge React (smartapply.indeed.com, MAIN world)
  +-- Background Service Worker
  |     +-- index.ts → roteamento de mensagens + keep-alive
  |     +-- orchestrator.ts → maquina de estados + gestao de tabs/workers
  +-- Services
  |     +-- claude.ts → cliente HTTP para backend (AI)
  |     +-- pdf.ts → geracao de PDFs (CV + carta)
  |     +-- job-registry.ts → registro de vagas aplicadas/skipadas
  |     +-- answer-cache.ts → cache inteligente de respostas de formulario
  +-- Utils
        +-- constants.ts → seletores, timeouts, keywords
        +-- selectors.ts → helpers DOM (fill, select, file upload, validacao)
        +-- i18n.ts → internacionalizacao
```

### 2.2 Backend (Proxy API - separado)

O backend e um servidor FastAPI que serve como proxy para a API do Claude e gera PDFs.

| Endpoint | Metodo | Funcao |
|---|---|---|
| `/api/answer` | POST | Formulario → resposta IA |
| `/api/tailor` | POST | Vaga → CV/carta personalizada |
| `/api/generate-pdf` | POST | HTML → PDF (Playwright) |
| `/api/pdf/{filename}` | GET | Buscar PDF pre-gerado |
| `/health` | GET | Health check |

### 2.3 Modelo de Comunicacao

```
Popup ←→ Background (chrome.runtime.sendMessage)
Content Scripts ←→ Background (chrome.runtime.sendMessage)
smartapply.ts ←→ mainworld.ts (window.postMessage) — cross-world
Background → Backend (fetch HTTP)
```

---

## 3. Maquina de Estados (Bot)

### 3.1 Estados

| Estado | Descricao |
|---|---|
| `idle` | Parado, aguardando inicio |
| `collecting` | Coletando links de vagas das paginas de busca |
| `applying` | Aplicando para vagas (wizard SmartApply) |
| `paused` | Pausado pelo usuario |
| `waiting_user` | Aguardando acao do usuario (revisao de formulario) |

### 3.2 Transicoes

```
idle → collecting (START_BOT)
collecting → applying (coleta finalizada)
applying → waiting_user (formulario preenchido, aguarda revisao)
waiting_user → applying (usuario clicou Continue/Submit)
qualquer → paused (PAUSE_BOT)
paused → estado_anterior (RESUME_BOT)
qualquer → idle (STOP_BOT)
```

---

## 4. Estrutura de Dados

### 4.1 Job Entry

```typescript
interface JobEntry {
  url: string
  jobKey: string           // ID unico da vaga (param ?jk= ou ?vjk=)
  title: string
  company: string
  status: 'pending' | 'in_progress' | 'applied' | 'skipped' | 'failed'
  skipReason?: string      // motivo do skip (external, duplicate, error, etc.)
}
```

### 4.2 Settings

```typescript
interface Settings {
  // Backend
  backendUrl: string

  // Busca
  searchUrls: string[]      // URLs de busca do Indeed (uma por linha)
  maxApplies: number         // 0 = ilimitado
  scrapingTabs: number       // 1-5 tabs paralelas para coleta
  language: 'br' | 'us' | 'uk' | 'fr' | 'de' | 'es'

  // Perfil
  name: string
  email: string
  phone: string
  address: {
    street: string
    neighborhood: string
    city: string
    state: string
    cep: string
  }
  links: {
    linkedin: string
    github: string
    portfolio: string
    instagram: string
  }

  // Dados pessoais (Brasil)
  birthDate: string          // DD/MM/YYYY
  rg: string
  cpf: string
  motherName: string
  fatherName: string
  country: string            // default "Brasil"

  // Personalizacao (IA)
  personalization: {
    enabled: boolean
    baseCv: string           // markdown
    baseCoverLetter: string  // markdown
    baseProfile: string      // markdown com dados pessoais
  }

  // Botao flutuante
  floatingButton: {
    enabled: boolean
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    style: 'fixed' | 'absolute' | 'sticky'
    size: 'small' | 'medium' | 'large'
    opacity: number          // 0.1 a 1.0
    showSkip: boolean
  }

  // Disponibilidade
  availableToday: boolean    // auto-preenche campos de data com data de hoje
}
```

### 4.3 Mensagens (Background ↔ Content Scripts ↔ Popup)

| Mensagem | Direcao | Funcao |
|---|---|---|
| `START_BOT` | Popup → BG | Iniciar bot |
| `STOP_BOT` | Popup → BG | Parar bot |
| `PAUSE_BOT` | Popup → BG | Pausar bot |
| `RESUME_BOT` | Popup → BG | Retomar bot |
| `GET_STATE` | Popup → BG | Obter estado atual |
| `STATUS_UPDATE` | BG → Popup | Atualizar status/contadores |
| `COLLECT_LINKS` | BG → indeed.ts | Coletar links de vagas na pagina |
| `CLICK_APPLY` | BG → indeed.ts | Clicar botao Apply |
| `SCRAPE_JOB` | BG → indeed.ts | Extrair info da vaga |
| `FILL_AND_ADVANCE` | BG → smartapply.ts | Preencher formulario + avancar |
| `ASK_CLAUDE` | smartapply.ts → BG | Pedir resposta IA para campo |
| `STEP_ADVANCED` | smartapply.ts → BG | Pagina do wizard avancou |
| `TAB_SUBMITTED` | smartapply.ts → BG | Candidatura submetida |
| `TAB_SKIPPED` | smartapply.ts → BG | Vaga skipada pelo usuario |
| `ADD_LOG` | qualquer → BG | Adicionar entrada no log |
| `SCRAPE_LINKEDIN` | Options → BG | Importar perfil LinkedIn |

---

## 5. Fluxo Principal

### 5.1 Fase 1: Coleta de Vagas

1. Usuario clica "Start" no popup
2. Background carrega settings do `chrome.storage.local`
3. Para cada `searchUrl`:
   a. Abre tab, navega para URL
   b. Scrape primeira pagina → obtem total de vagas e paginas
   c. Lanca tabs paralelas (ate `scrapingTabs`, max 5)
   d. Distribui paginas restantes entre tabs
   e. Cada tab coleta links de vagas (`div[data-testid="slider_item"]`)
4. Deduplicacao por `jobKey`
5. Filtragem:
   - Remove vagas com apply externo ("company site", "site da empresa")
   - Remove vagas ja conhecidas (registry: applied ou skipped)
   - Remove duplicatas da mesma busca
6. Early exit: para quando `maxApplies` atingido OU 3 paginas vazias consecutivas

**Estatisticas reportadas:** totalCards, externalApply, duplicates, alreadyKnown

### 5.2 Fase 2: Aplicacao (Modo Human-Review)

1. Orchestrator pega proxima vaga pendente
2. Navega tab para URL da vaga
3. Scrape info da vaga (titulo, empresa, descricao)
4. Gera CV/carta personalizados via IA (com cache por titulo)
5. Envia `FILL_AND_ADVANCE` para smartapply.ts
6. smartapply.ts preenche formularios automaticamente
7. Estado muda para `waiting_user` → usuario revisa e clica botoes nativos do Indeed
8. smartapply.ts detecta avanco de pagina → notifica orchestrator
9. Repete preenchimento para proxima pagina do wizard
10. Detecta submissao (URL contem "confirmation"/"submitted"/"success"/"post-apply")
11. Marca vaga como applied → proxima vaga

**Worker Lifecycle:**
```
navigating → filling → waiting_review → done
```

---

## 6. SmartApply Wizard - Regras de Preenchimento

### 6.1 Upload de CV (Resume)

**6 estrategias em cascata (tenta ate funcionar):**

1. **Input direto:** Busca `<input type="file">`, seta arquivos via DataTransfer
2. **Reset + upload:** Clica ResumeOptionsMenu → "Carregar um arquivo diferente" → upload
3. **Botao "Selecionar arquivo":** Click intercept no botao de upload
4. **Todos os botoes:** Tenta todos os elementos clicaveis de upload
5. **API upload:** POST `/api/v1/files` com CSRF token (fallback direto)
6. **CV existente:** Usa CV ja carregado no perfil do Indeed (ultimo recurso)

**Verificacao:** Polls o label do resume por ate 5s buscando nome do arquivo OU texto "Carregado agora"

**Cross-world (React):**
- ISOLATED world seta arquivos via DataTransfer
- Envia dados base64 via `postMessage` para MAIN world
- MAIN world reconstroi File, encontra React onChange via `__reactFiber$` (busca ate depth 20)
- Dispara onChange do React diretamente

### 6.2 Upload de Carta de Apresentacao (Cover Letter)

**Deteccao:** Seletores especificos + keywords: "cover letter", "carta de apresentacao", "lettre de motivation"

**Estrategias:**
1. Input direto de arquivo
2. Clica botao de cover letter → espera input aparecer
3. Scan de todos os clicaveis com keywords de cover

### 6.3 Documentos Adicionais

- Na pagina de revisao: detecta secao "Supporting documents" / "Documentos de apoio"
- Clica "Adicionar" / "Add"
- Na pagina de documentos adicionais: seleciona radio "Write a cover letter" (evita "no cover letter")

### 6.4 Formularios (Questionnaire)

#### Campos de Texto / Textarea

1. Pula se visivel + nao vazio + sem `aria-invalid`
2. Detecta campos de data: `type="date"` OU placeholder com padrao [DMY] OU label com keywords de data
3. **Regra de Data:**
   - Se `availableToday=true` → preenche com data de hoje (pula IA)
   - Formato: DD/MM/YYYY para br.indeed, MM/DD/YYYY para demais
4. Para outros campos: pergunta ao Claude via backend
5. Pre-validacao: `validateAnswer()` (numero, formato de data, length, pattern)
6. Pos-preenchimento: detecta erro via `aria-invalid`, `aria-errormessage`, `.error`
7. Retry: ate 2 tentativas com contexto de erro

#### Select (Dropdown)

1. Pula se valor nao vazio e sem `aria-invalid`
2. Pergunta ao Claude qual opcao escolher
3. Matching de opcao: exato → case-insensitive → parcial → fallback primeira opcao
4. Invalida React `_valueTracker` para forcar re-render

#### Radio Groups

1. Encontra label do grupo via `data-testid*="input-q_"`, `.ia-Questions-item`, `fieldset`
2. Extrai labels das opcoes via `getLabelForInput()`
3. Pergunta ao Claude → seleciona opcao correspondente
4. Pula radios de cover letter (tratados separadamente)

#### Checkboxes (Multi-select)

1. Agrupa por atributo `name`
2. Pergunta ao Claude (prompt MULTI-SELECT)
3. Resposta com separador `|` (ex: "Option A|Option C")
4. Marca cada opcao correspondente

### 6.5 Paginas Especiais

| Pagina | Acao Automatica |
|---|---|
| Privacy Settings | Opt-in (`[data-testid="privacy-settings-optin-input"]`) + Continue |
| Additional Documents | Seleciona "Write a cover letter" radio |
| Consent/Terms | Auto-check checkboxes com keywords: "agree", "aceito", "concordo", "autorizo", "terms", "privacy" |

### 6.6 Deteccao de Avanco de Pagina

**Metodos (em ordem de confiabilidade):**
1. Mudanca de URL (mais confiavel)
2. Mudanca de DOM > 500 bytes apos 3000ms de settle

**Debounce:** Espera 800ms apos ultima mutacao antes de checar

**Resultado:** Envia `STEP_ADVANCED` (proxima pagina) ou `TAB_SUBMITTED` (candidatura concluida)

### 6.7 Deteccao de Submissao

URL contem um dos termos: `confirmation`, `submitted`, `success`, `post-apply`
OU: saiu de `smartapply.indeed.com`

### 6.8 Fallback DOM (quando pagina desconhecida)

1. Extrai DOM simplificado (limite 3000 chars)
2. Pergunta ao Claude: "O que fazer nesta pagina?"
3. Respostas possíveis:
   - `CLICK:<testid>` → clica elemento por data-testid
   - `CLICK_TEXT:<texto>` → clica botao por texto
   - `SELECT:<testid>` → seleciona elemento
   - `SKIP` → pula pagina
4. Regras do Claude para fallback: opt-in para empresas encontrarem, aceitar termos, clicar continue

---

## 7. Constantes e Limites

### 7.1 Timeouts

| Constante | Valor | Descricao |
|---|---|---|
| `tabLoadTimeout` | 15000ms | Timeout para carregar tab |
| `settleMs` | 3000ms | Espera React re-render apos upload de CV |
| `debounceMutationMs` | 800ms | Debounce de mutacoes DOM |
| `pageLoadDelay` | 2000ms | Delay apos tab carregar antes de scrape |
| `workerStaggerDelay` | 500ms | Delay entre lancamento de tabs workers |

### 7.2 Limites

| Constante | Valor | Descricao |
|---|---|---|
| `maxFillDepth` | 10 | Max iteracoes de preenchimento (previne loop infinito) |
| `maxRetries` | 2 | Retentativas em erro de validacao |
| `jobsPerPage` | 10 | Vagas por pagina do Indeed |
| `emptyPageStreak` | 3 | Paginas vazias consecutivas para parar coleta |
| `simplifiedDomMaxLength` | 3000 | Limite de chars do DOM para analise IA |
| `domChangeThreshold` | 500 | Bytes minimos de mudanca de DOM para detectar avanco |
| `scrapingTabs` | 1-5 | Tabs paralelas para coleta |

### 7.3 Keywords Multi-idioma

**Submit:** "submit", "soumettre", "enviar", "bewerben", "postular", "candidatura"
**Continue:** "continue", "continuer", "proximo", "weiter"
**Consent:** "agree", "aceito", "concordo", "autorizo", "terms", "privacy", "notification"

---

## 8. Seletores DOM Criticos

### 8.1 Indeed (pagina de busca)

| Elemento | Seletor |
|---|---|
| Card de vaga | `div[data-testid="slider_item"]` |
| Botao Apply | `[data-testid="indeedApply"]` |
| JobKey | URL param `?jk=` ou `?vjk=` |

### 8.2 SmartApply (wizard)

| Elemento | Seletor |
|---|---|
| Resume radio (novo) | `[data-testid*="resume-selection-file-resume-upload-radio-card"]` |
| Resume radio (antigo) | `[data-testid*="resume-selection-file-resume-radio-card"]` |
| Resume options menu | `[data-testid="ResumeOptionsMenu"]` |
| Continue button | `[data-testid="continue-button"]` |
| Privacy opt-in | `[data-testid="privacy-settings-optin-input"]` |
| Privacy form | `[data-testid="privacy-settings-form"]` |
| Question input | `[data-testid*="input-q_"]` |
| Cover letter textarea | Keywords: "cover letter", "carta de apresentacao" |

**IMPORTANTE:** Indeed usa React 18 com Module Federation (arquitetura "mosaic"). Seletores podem mudar. Manter suporte a ambos padroes (antigo e novo) de data-testid.

---

## 9. Cache e Persistencia

### 9.1 Job Registry (`chrome.storage.local` → key `jobRegistry`)

- `applied: Set<jobKey>` → vagas aplicadas
- `skipped: Map<jobKey, reason>` → vagas skipadas
- **Regra:** Uma vez marcada como applied, nao pode ser skipada

### 9.2 Answer Cache (in-memory)

- Tokeniza perguntas (remove stop words em PT e EN)
- **Similarity Matching:** Jaccard similarity
  - Lookup threshold: 0.5 (50% similaridade)
  - Update threshold: 0.85 (85% similaridade → atualiza cache existente)
- **Matching de opcoes:** Levenshtein distance (threshold 0.3)
- Armazena: label, tokens, inputType, answer, options

### 9.3 Cache de PDFs

- **In-memory:** `Map[safeTitle]` → `{cvPdfData, cvOnlyPdfData, coverPdfData, filenames}`
- **Disco:** Backend `output/` folder, acessivel via `GET /api/pdf/{filename}`
- **Chave:** titulo da vaga normalizado (trim, replace spaces→_, remove chars especiais, max 60 chars)
- **3 variantes de PDF:**
  1. CV Only (sem carta)
  2. CV + Cover Letter embedded (page break entre eles)
  3. Cover Letter Only

### 9.4 Settings (`chrome.storage.local`)

Todas as configuracoes persistidas via `chrome.storage.local`. Mudancas no floating button refletem em tempo real via `chrome.storage.onChanged`.

---

## 10. Geracao de PDF (Templates)

### 10.1 Templates HTML

- `assets/cv_template.html` → template do CV
- `assets/cover_template.html` → template da carta

### 10.2 Placeholders

**CV:**
```
{{profile_name}}    → nome em MAIUSCULO
{{profile_contact}} → email | phone | LinkedIn | GitHub | location
{{objective}}       → objetivo personalizado
{{summary}}         → resumo profissional
{{section_skills}}  → secao de skills
{{skills}}          → lista de skills
{{experience}}      → experiencia profissional
{{education}}       → formacao
{{certifications}}  → certificacoes
{{languages}}       → idiomas
{{keywords}}        → palavras-chave
{{additional_info}} → info adicional
```

**Carta:**
```
{{subtitle}}    → subtitulo
{{greeting}}    → saudacao
{{paragraphs}}  → paragrafos do corpo
{{closing}}     → fechamento
{{date}}        → data
```

---

## 11. Internacionalizacao (i18n)

### 11.1 Idiomas Suportados

| Codigo | Idioma | Status |
|---|---|---|
| `br` | Portugues (Brasil) | Completo (default) |
| `us` | Ingles (EUA) | Completo |
| `uk` | Ingles (UK) | Completo (usa en) |
| `es` | Espanhol | Completo |
| `fr` | Frances | Fallback para en |
| `de` | Alemao | Fallback para en |

### 11.2 Mecanismo

- Arquivos JSON de locale carregados dinamicamente
- Detecta idioma do navegador como fallback (`navigator.language`)
- Atributos de traducao: `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`

---

## 12. Service Worker (MV3) - Keep Alive

- Service workers do MV3 sao encerrados apos ~30s de inatividade
- Solucao: `chrome.alarms` configurado a cada 0.4min (24s)
- Alarm limpo quando estado = `idle`

---

## 13. LinkedIn Import

**Fluxo (Options Page):**
1. Usuario insere URL/username do LinkedIn
2. Background abre tab do LinkedIn, injeta script
3. Extrai: nome, headline, about, experiencia, educacao, skills, idiomas, certificacoes, links de contato
4. Gera markdown de CV a partir dos dados
5. Preenche campos de perfil na Options Page

---

## 14. Tratamento de Erros

### 14.1 Formularios

| Erro | Acao |
|---|---|
| Campo com `aria-invalid` | Retry (ate 2x) com contexto de erro |
| Validacao falhou (pre-fill) | Ajusta resposta (trunca, reformata) |
| Campo de data invalido | Usa data de hoje como fallback |
| Select sem match | Usa primeira opcao como fallback |
| Max fill depth (10) | Para preenchimento, espera usuario |

### 14.2 Navegacao

| Erro | Acao |
|---|---|
| Tab nao carregou (15s timeout) | Skip vaga |
| Wizard nao apareceu | Skip vaga, marca failed |
| Erro na geracao de CV | Skip vaga |
| Tab saiu do smartapply | Marca como submitted ou failed |

### 14.3 Recovery

- Retry com contexto de erro (valor atual + mensagem de erro)
- Para campos de data: sempre fallback para data de hoje (IA erra frequentemente)
- Para texto: trunca ao maxLength se exceder

---

## 15. Permissoes Chrome

```json
{
  "permissions": ["tabs", "storage", "notifications", "alarms", "tabGroups", "activeTab", "scripting"],
  "host_permissions": ["*://*.indeed.com/*", "*://*.linkedin.com/*", "http://localhost:*/*"]
}
```

---

## 16. Regras de Negocio Criticas (Resumo)

1. **Modo Human-Review:** Bot preenche, usuario clica botoes nativos do Indeed
2. **availableToday=true** → data de hoje para TODOS os campos de data (pula IA)
3. **Resume upload DEVE resetar React** antes de enviar novo CV se ja existe um
4. **Retry de formulario:** max 2x; na ultima falha: data de hoje para datas, truncar para texto
5. **Cache de respostas:** 50% similarity para lookup, 85% para update
6. **Deduplicacao:** por jobKey na busca + registry global
7. **Settle de pagina:** esperar 3000ms para React antes de baseline DOM
8. **Multi-select:** separador `|` nas respostas; match por Levenshtein (threshold 0.3)
9. **Deteccao de submissao:** URL com "confirmation"/"submitted"/"success"/"post-apply"
10. **Loop prevention:** max 10 iteracoes de preenchimento
11. **Apply externo:** vagas com "company site"/"site da empresa" sao skipadas
12. **Tab reuse:** worker unico aplica sequencialmente; reutiliza tab
13. **Uma vez applied, nao pode ser re-skipada** (registry imutavel para applied)
14. **Cross-world:** ISOLATED → postMessage → MAIN world para React integration
15. **Keep-alive:** alarm de 24s para manter service worker vivo durante operacao
