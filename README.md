# Indeed Auto-Apply Bot

**WARNING:**
This guide explains how to use this bot. Use at your own risk. Indeed may change their website or introduce new protections (such as captchas or anti-bot measures) at any time, which could break this tool or result in your account being restricted. This is for educational purposes only.

---

## Features

- Automatically finds and applies to jobs on Indeed with "Indeed Apply"
- Uses [Camoufox](https://github.com/daijro/camoufox) for stealth browser automation
- Multi-step application wizard handling (resume upload, personal info, submit)
- AI-powered CV/cover letter personalization per job (via Claude CLI)
- Multi-language support (BR, EN, FR, DE, ES, etc.)
- Configurable apply limits and run modes

---

## Prerequisites

- Python 3.9+
- [uv](https://github.com/astral-sh/uv) (recommended) or pip
- An Indeed account with:
  - Your CV already uploaded
  - Your name, address, and phone number filled in your Indeed profile

---

## Setup

1. **Clone and install dependencies:**

    ```bash
    git clone https://github.com/DIEGOHORVATTI/indeed_bot.git
    cd indeed_bot
    uv sync
    ```

2. **Edit `config.yaml`:**

    ```yaml
    search:
      # Option A: multiple pre-built search URLs
      base_urls:
        - 'https://br.indeed.com/jobs?q=full+stack&l=Florianópolis&fromage=7&radius=100'
        - 'https://br.indeed.com/jobs?q=nodejs&l=Brasil&sc=0kf%3Aattr%28DSQF7%29%3B'

      # Option B: single URL with pagination
      base_url: 'https://br.indeed.com/jobs?q=full+stack&l=Florianópolis'
      start: 0
      end: 100

    camoufox:
      user_data_dir: 'user_data_dir'
      language: 'br'  # br, us, uk, fr, de, es, etc.
      # proxy_server: 'socks5://host:port'  # optional
      # proxy_username: 'user'               # optional
      # proxy_password: 'pass'               # optional

    personalization:
      enabled: true
      base_cv_path: 'assets/base_cv.md'
      base_cover_letter_path: 'assets/base_cover_letter.md'
      claude_cli_path: 'claude'
      output_dir: 'output'
    ```

    | Field | Description |
    |---|---|
    | `base_urls` | List of search URLs (takes priority over `base_url`) |
    | `base_url` | Single search URL, paginated with `start`/`end` |
    | `language` | Indeed locale code (`br`, `us`, `uk`, `fr`, `de`, etc.) |
    | `user_data_dir` | Browser profile directory (persists login session) |
    | `personalization.enabled` | Enable AI-tailored CV/cover letter per job |

3. **How to get your search URL:**

    - Go to [Indeed](https://www.indeed.com/) in your browser
    - Set your filters (job title, location, remote, date posted, etc.)
    - Click **Find jobs**
    - Copy the URL from your browser's address bar
    - Paste it into `config.yaml`

    ![How to get your base_url](assets/Readme.png)

4. **Upload your CV to Indeed:**
    - Go to your Indeed profile and upload your CV
    - Make sure your name, address, and phone number are filled in

---

## Usage

```bash
# Full mode (two-pass paginated search, default)
uv run python -m app

# Minimal mode (single-pass, no pagination)
uv run python -m app --mode minimal

# Limit number of applications
uv run python -m app --max 10

# Combine options
uv run python -m app --mode minimal --max 5 --config my_config.yaml
```

### CLI Options

```
usage: indeed-bot [-h] [--mode {full,minimal}] [--max MAX_APPLIES] [--config CONFIG]

options:
  --mode {full,minimal}  Run mode (default: full)
  --max MAX_APPLIES      Max jobs to apply to (default: unlimited)
  --config CONFIG        Path to config.yaml (default: config.yaml)
```

### Standalone Scripts

```bash
# Get login token (auto-fill or manual)
uv run python scripts/get_token.py --email user@example.com --password pass

# Collect job links only (JSON output)
uv run python scripts/collect_links.py

# Apply to collected links
uv run python scripts/apply_jobs.py --max 20 --delay 5
```

---

## First Run

1. Run the bot — if not logged in, it will open Indeed's login page:

    ```bash
    uv run python -m app
    ```

2. Log in manually in the browser window that opens
3. The bot detects your session cookie and proceeds automatically
4. Your session is saved in `user_data_dir` for future runs

---

## AI Personalization

When `personalization.enabled: true`, the bot will:

1. Scrape the job description from each job page
2. Call Claude CLI to generate a tailored CV and cover letter (JSON)
3. Fill HTML templates (`assets/cv_template.html`, `assets/cover_template.html`)
4. Convert to PDF and upload during the application

Base content files:
- `assets/base_cv.md` — your CV in markdown (source of truth)
- `assets/base_cover_letter.md` — your cover letter template

Generated PDFs are saved in `output/`.

---

## Project Structure

```
indeed_bot/
├── app/
│   ├── __main__.py          # python -m app entrypoint
│   ├── cli.py               # Unified CLI (argparse)
│   ├── bot.py               # IndeedBot class (orchestrator)
│   ├── models/
│   │   └── config.py        # Pydantic config models
│   ├── services/
│   │   ├── browser.py       # Camoufox browser setup + proxy
│   │   ├── cv_generator.py  # Job scraping + Claude CLI calls
│   │   └── pdf.py           # HTML template filling + PDF conversion
│   └── utils/
│       ├── indeed.py        # collect_links, apply_to_job
│       ├── login.py         # ensure_ppid_cookie
│       ├── logger.py        # Dual logger (file + console)
│       ├── pagination.py    # URL pagination
│       └── selectors.py     # DOM helpers (find_first, click_first)
├── scripts/
│   ├── get_token.py         # Login and print PPID token
│   ├── collect_links.py     # Collect job links (JSON)
│   └── apply_jobs.py        # Apply to specific jobs
├── assets/
│   ├── base_cv.md           # Base CV content
│   ├── base_cover_letter.md # Base cover letter content
│   ├── cv_template.html     # CV HTML template
│   └── cover_template.html  # Cover letter HTML template
├── _tests/                  # Unit tests
├── config.yaml              # User configuration
└── pyproject.toml           # Dependencies and project metadata
```

---

## Troubleshooting

- **Bot gets stuck or fails to apply:** Check `indeed_apply.log` for errors
- **Login not detected:** Delete `user_data_dir/` and run again to get a fresh session
- **CV generation fails:** Ensure `claude` CLI is installed and accessible in your PATH
- **Captcha appears:** Solve it manually in the browser window; the bot will wait and continue

---

## Disclaimer

This project is not affiliated with Indeed. Use at your own risk.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
