# Indeed Auto Apply

Chrome extension + backend API for auto-applying to Indeed jobs with AI-tailored CVs and smart form filling.

> **Warning:** Use at your own risk. Indeed may change the site or add protections at any time.

---

## Features

- Auto-apply to "Indeed Apply" jobs directly from the browser
- AI-tailored CV and cover letter per job (via Claude API or CLI)
- Resume upload on SmartApply (React file input + fallback)
- Auto-fill questionnaires (default answers + cache + Claude)
- External job detection — auto-skip
- Persistent registry of applied/skipped jobs — never applies twice
- Multi-language support (BR, EN, FR, DE, ES)

---

## Prerequisites

- [Node.js](https://nodejs.org/) (extension build)
- Python 3.9+ and [uv](https://github.com/astral-sh/uv) (backend)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed **or** `ANTHROPIC_API_KEY` set
- Indeed account with completed profile

---

## Setup

### 1. Backend

```bash
git clone https://github.com/DIEGOHORVATTI/indeed_bot.git
cd indeed_bot
uv sync

# Configure environment
cp .env.example .env
# Edit .env — see Environment Variables below

# Install Playwright for PDF generation
uv run playwright install chromium

# Start server
uv run uvicorn apps.backend.server:app --host 0.0.0.0 --port 3000
```

### 2. Extension

```bash
cd apps/extension
npm install    # or: bun install
npm run build
```

- Go to `chrome://extensions/`
- Enable **Developer mode**
- Click **Load unpacked** → select `apps/extension/dist`
- Click the extension icon → **Options** → fill in your profile, backend URL, and base CV

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `cli` | `"cli"` (Claude CLI) or `"api"` (Anthropic SDK) |
| `ANTHROPIC_API_KEY` | — | Required when `AI_PROVIDER=api` |
| `CLAUDE_CLI_PATH` | auto-detect | Path to `claude` binary (optional) |
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-4-5-20251001` | Model for quick tasks (form answers) |
| `ANTHROPIC_MODEL_SMART` | `claude-opus-4-20250514` | Model for complex tasks (CV tailoring) |

---

## Project Structure

```
apps/
├── backend/
│   ├── server.py         # FastAPI — 5 endpoints
│   ├── ai_provider.py    # Anthropic SDK / Claude CLI abstraction
│   └── pdf.py            # HTML → PDF via Playwright subprocess
└── extension/
    ├── src/
    │   ├── background/   # Service worker + orchestrator
    │   ├── content/      # Content scripts (isolated + main world)
    │   ├── popup/        # Popup UI
    │   ├── options/      # Settings page
    │   ├── services/     # Claude, PDF, cache, job registry
    │   └── utils/        # Selectors, i18n, notifications
    ├── manifest.json
    └── webpack.config.js
assets/                   # HTML templates (cv_template.html, cover_template.html)
```

---

## Backend API Reference

Base URL: `http://localhost:3000`

### `GET /health`

Health check.

**Response `200`**
```json
{ "status": "ok" }
```

---

### `POST /api/answer`

Answer a job application form question using AI + candidate profile.

**Request**
```json
{
  "question": "What is your expected salary?",
  "options": ["50k", "60k", "70k"],
  "jobTitle": "Software Engineer",
  "baseProfile": "Name: John Doe\nExperience: 5 years...",
  "constraints": {
    "type": "number",
    "maxLength": 10,
    "minLength": 1,
    "min": "0",
    "max": "999999",
    "pattern": "^[0-9]+$",
    "placeholder": "e.g. 60000"
  },
  "errorContext": "Previous answer was rejected: value too long"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `question` | `string` | **yes** | Form field label or question text |
| `options` | `string[]` | no | Select/radio options — AI picks the best match |
| `jobTitle` | `string` | no | Job being applied for (gives AI context) |
| `baseProfile` | `string` | no | Candidate profile (personal data, experience, etc.) |
| `constraints` | `object` | no | Input field constraints (see below) |
| `errorContext` | `string` | no | Error from a previous attempt (retry logic) |

**Constraints object:**

| Field | Type | Description |
|---|---|---|
| `type` | `string` | Input type: `text`, `number`, `date`, etc. |
| `maxLength` | `int` | Max character length |
| `minLength` | `int` | Min character length |
| `min` | `string` | Min value (number/date inputs) |
| `max` | `string` | Max value (number/date inputs) |
| `pattern` | `string` | Regex the answer must match |
| `placeholder` | `string` | Expected format hint |

**Response `200`**
```json
{
  "answer": "60000"
}
```

**Response `502`** — AI provider error
```json
{
  "detail": "error message"
}
```

**Behavior:**
- Uses `MODEL_FAST` (Haiku) for speed.
- If `options` provided → AI picks best match, falls back to first option.
- Respects `constraints` to produce valid form input.
- If `errorContext` set → AI adjusts answer based on previous error.

---

### `POST /api/tailor`

Generate a tailored CV + cover letter for a specific job posting.

**Request**
```json
{
  "jobTitle": "Senior Frontend Developer",
  "jobCompany": "Acme Corp",
  "jobDescription": "We are looking for a senior frontend developer with React, TypeScript...",
  "baseCv": "Full text of candidate's base CV...",
  "baseCoverLetter": "Full text of candidate's base cover letter..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `jobTitle` | `string` | **yes** | Target job title |
| `jobCompany` | `string` | **yes** | Company name |
| `jobDescription` | `string` | **yes** | Full job posting (truncated to 4000 chars internally) |
| `baseCv` | `string` | **yes** | Candidate's base CV text |
| `baseCoverLetter` | `string` | **yes** | Candidate's base cover letter text |

**Response `200`**
```json
{
  "objective": "Senior Frontend Developer",
  "section_summary": "Professional Summary",
  "summary": "Frontend engineer with 5+ years building React/TypeScript SPAs...",
  "keywords": ["React", "TypeScript", "Next.js", "Node.js"],
  "section_skills": "Technical Skills",
  "skills": [
    { "label": "Front-End", "items": "React.js, Next.js, TypeScript" },
    { "label": "Back-End", "items": "Node.js, Python, PostgreSQL" }
  ],
  "section_experience": "Professional Experience",
  "experience": [
    {
      "title": "Frontend Developer",
      "date": "01/2022 – Present",
      "company": "TechCo · Remote",
      "bullets": [
        "Built a React component library used by 50+ developers",
        "Reduced bundle size by 40% using code splitting"
      ]
    }
  ],
  "section_education": "Education",
  "education": [
    {
      "degree": "B.Sc. Computer Science",
      "institution": "University of São Paulo",
      "period": "2016–2020"
    }
  ],
  "section_certifications": "Certifications",
  "certifications": ["AWS Cloud Practitioner – Amazon"],
  "section_languages": "Languages",
  "languages": [
    { "name": "Portuguese", "level": "Native" },
    { "name": "English", "level": "B2 Upper-intermediate" }
  ],
  "section_additional": "Additional Information",
  "additional_info": "",
  "cover_subtitle": "Application for Senior Frontend Developer at Acme Corp",
  "cover_greeting": "Dear Hiring Manager,",
  "cover_paragraphs": [
    "I am writing to express my interest in the Senior Frontend Developer position...",
    "In my current role at TechCo, I have led the development of...",
    "I would welcome the opportunity to bring my expertise to Acme Corp..."
  ],
  "cover_closing": "Sincerely"
}
```

**Response `502`** — AI error or invalid JSON
```json
{
  "detail": "Invalid JSON from AI: ..."
}
```

**Behavior:**
- Uses `MODEL_SMART` (Opus) for higher quality.
- Auto-detects language from job description (PT-BR or English).
- Preserves all facts from base CV — only reorganizes and emphasizes.
- Output JSON is designed to feed into HTML templates for PDF generation.

---

### `POST /api/generate-pdf`

Convert HTML to PDF via Playwright (headless Chromium).

**Request**
```json
{
  "html": "<html><body><h1>My CV</h1>...</body></html>",
  "filename": "john_doe_cv.pdf"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `html` | `string` | **yes** | Full HTML to render as A4 PDF |
| `filename` | `string` | no | If set, saves a copy to `apps/output/` |

**Response `200`** — Binary PDF

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="john_doe_cv.pdf"
```

**Response `500`**
```json
{
  "detail": "PDF generation failed: ..."
}
```

**Behavior:**
- Renders full-page A4 with zero margins (template controls margins via CSS).
- If `filename` provided, a copy is saved to `apps/output/` for later retrieval via `GET /api/pdf/{filename}`.

---

### `GET /api/pdf/{filename}`

Retrieve a previously generated PDF from `output/`.

**Response `200`** — Binary PDF

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="john_doe_cv.pdf"
```

**Response `404`**
```json
{ "detail": "PDF not found" }
```

**Response `400`**
```json
{ "detail": "Invalid filename" }
```

---

## Extension Scripts

| Command | Description |
|---|---|
| `npm run build` | Production build (webpack) |
| `npm run dev` | Dev build with watch mode |
| `npm run bump` | Bump version in package.json + manifest.json |
| `npm run release` | Bump + build + commit + push |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Extension can't connect to backend | Check backend is running and URL is correct in Options |
| CV not generated | Check `claude` CLI is installed (or `ANTHROPIC_API_KEY` is set) |
| Job is skipped | May be an external job (redirects to company site) or already applied |
| PDF generation fails | Run `playwright install chromium` |

---

## Disclaimer

This project is not affiliated with Indeed. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE).
