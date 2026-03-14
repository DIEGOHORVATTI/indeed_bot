const API_URL = 'https://apis.indeed.com/graphql'

const API_HEADERS: Record<string, string> = {
  'Host': 'apis.indeed.com',
  'content-type': 'application/json',
  'indeed-api-key': '161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8',
  'accept': 'application/json',
  'accept-language': 'pt-BR,pt;q=0.9',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1',
  'indeed-app-info': 'appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone',
}

const JOB_SEARCH_QUERY = `
  query GetJobData {
    jobSearch(
      {what}
      {location}
      limit: {limit}
      {cursor}
      sort: RELEVANCE
      {filters}
    ) {
      pageInfo { nextCursor }
      results {
        job {
          key
          title
          datePublished
          description { html }
          location {
            city
            admin1Code
            countryCode
            formatted { short long }
          }
          compensation {
            baseSalary {
              unitOfWork
              range { ... on Range { min max } }
            }
            currencyCode
          }
          attributes { key label }
          employer {
            name
            relativeCompanyPageUrl
            dossier {
              employerDetails {
                addresses
                industry
                employeesLocalizedLabel
              }
              images { squareLogoUrl }
              links { corporateWebsite }
            }
          }
          recruit { viewJobUrl detailedSalary }
        }
      }
    }
  }
`

export interface ScrapeParams {
  searchTerm: string
  location: string
  country: string
  radius?: number
  maxResults?: number
  hoursOld?: number
  easyApplyOnly?: boolean
}

export interface ScrapedJob {
  jobKey: string
  title: string
  company: string | null
  city: string | null
  state: string | null
  countryCode: string | null
  locationFormatted: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryUnit: string | null
  description: string | null
  datePublished: number | null
  attributes: string[]
  applyUrl: string | null
  companyUrl: string | null
  url: string
}

function buildQuery(params: ScrapeParams, cursor: string | null): string {
  const searchTerm = params.searchTerm.replace(/"/g, '\\"')
  const location = params.location.replace(/"/g, '\\"')
  const limit = Math.min(params.maxResults ?? 100, 100)

  let filters = ''
  if (params.hoursOld) {
    filters = `filters: { date: { field: "dateOnIndeed", start: "${params.hoursOld}h" } }`
  } else if (params.easyApplyOnly) {
    filters = `filters: { keyword: { field: "indeedApplyScope", keys: ["DESKTOP"] } }`
  }

  return JOB_SEARCH_QUERY
    .replace('{what}', searchTerm ? `what: "${searchTerm}"` : '')
    .replace('{location}', `location: {where: "${location}", radius: ${params.radius ?? 100}, radiusUnit: MILES}`)
    .replace('{limit}', String(limit))
    .replace('{cursor}', cursor ? `cursor: "${cursor}"` : '')
    .replace('{filters}', filters)
}

function parseJob(raw: any, country: string): ScrapedJob {
  const comp = raw.compensation
  const range = comp?.baseSalary?.range ?? {}
  const loc = raw.location ?? {}
  const domain = country.toLowerCase() === 'br' ? 'br.indeed.com' : 'indeed.com'

  return {
    jobKey: raw.key,
    title: raw.title ?? '',
    company: raw.employer?.name ?? null,
    city: loc.city ?? null,
    state: loc.admin1Code ?? null,
    countryCode: loc.countryCode ?? null,
    locationFormatted: loc.formatted?.long ?? loc.formatted?.short ?? null,
    salaryMin: range.min ?? null,
    salaryMax: range.max ?? null,
    salaryCurrency: comp?.currencyCode ?? null,
    salaryUnit: comp?.baseSalary?.unitOfWork ?? null,
    description: raw.description?.html ?? null,
    datePublished: raw.datePublished ?? null,
    attributes: (raw.attributes ?? []).map((a: any) => a.label),
    applyUrl: raw.recruit?.viewJobUrl ?? null,
    companyUrl: raw.employer?.relativeCompanyPageUrl
      ? `https://${domain}${raw.employer.relativeCompanyPageUrl}`
      : null,
    url: `https://${domain}/viewjob?jk=${raw.key}`,
  }
}

function formatSalary(job: ScrapedJob): string | null {
  if (!job.salaryMin && !job.salaryMax) return null
  const parts = []
  if (job.salaryMin) parts.push(`${job.salaryMin}`)
  if (job.salaryMax && job.salaryMax !== job.salaryMin) parts.push(`${job.salaryMax}`)
  const range = parts.join(' - ')
  const currency = job.salaryCurrency ?? ''
  const unit = job.salaryUnit === 'MONTH' ? '/mes' : job.salaryUnit === 'YEAR' ? '/ano' : ''
  return `${currency} ${range}${unit}`.trim() || null
}

export async function scrapeIndeed(params: ScrapeParams): Promise<ScrapedJob[]> {
  const maxResults = params.maxResults ?? 100
  const allJobs: ScrapedJob[] = []
  let cursor: string | null = null
  const seenKeys = new Set<string>()

  const headers = {
    ...API_HEADERS,
    'indeed-co': params.country.toUpperCase(),
    'indeed-locale': params.country.toLowerCase() === 'br' ? 'pt-BR' : 'en-US',
  }

  while (allJobs.length < maxResults) {
    const query = buildQuery(params, cursor)

    const response = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      console.error(`[indeed-scraper] HTTP ${response.status}: ${await response.text()}`)
      break
    }

    const data = await response.json() as any

    if (data.errors?.length) {
      console.error(`[indeed-scraper] GraphQL errors:`, data.errors)
      break
    }

    const results = data.data?.jobSearch?.results ?? []
    if (results.length === 0) break

    for (const result of results) {
      const job = parseJob(result.job, params.country)
      if (seenKeys.has(job.jobKey)) continue
      seenKeys.add(job.jobKey)
      allJobs.push(job)
      if (allJobs.length >= maxResults) break
    }

    cursor = data.data?.jobSearch?.pageInfo?.nextCursor ?? null
    if (!cursor) break
  }

  return allJobs
}

export { formatSalary }
