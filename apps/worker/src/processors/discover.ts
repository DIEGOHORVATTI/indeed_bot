import type { Job } from 'bullmq'
import { getDb, insertJob } from '@jobpilot/db'
import { loadSearches } from '@jobpilot/db'
import { randomDelay, DELAY_DISCOVER } from '@jobpilot/anti-detection'
import { createSandbox } from '../browser/sandbox.js'
import type { BrowserSandbox } from '../browser/sandbox.js'
import { isExtensionConnected, startDiscovery } from '../bridge/extension-client.js'

type PlaywrightPage = {
  evaluate<R>(pageFunction: string): Promise<R>
}

export async function processDiscover(job: Job): Promise<{ jobIds: number[] }> {
  const db = getDb()
  const config = loadSearches()
  const searches = config.searches
  if (!searches?.length) {
    console.log('[discover] Nenhuma busca configurada')
    return { jobIds: [] }
  }

  const extConnected = await isExtensionConnected()
  if (extConnected) {
    console.log('[discover] Extensão conectada — delegando descoberta para o navegador real')
    const searchUrls = searches.map((s: any) => {
      const params = new URLSearchParams({
        q: s.query,
        l: s.location || '',
        fromage: String(s.hoursOld || 72),
      })
      return `https://br.indeed.com/jobs?${params.toString()}`
    })
    await startDiscovery(searchUrls, 0)
    return { jobIds: [] }
  }

  console.log('[discover] Extensão não conectada — usando Playwright headless')

  const allNewIds: number[] = []

  const sandbox: BrowserSandbox = await createSandbox()

  try {
    for (const search of searches) {
      const { query, location, resultsWanted = 30, country = 'Brazil' } = search
      console.log(`[discover] Buscando: '${query}' em ${location}`)

      const params = new URLSearchParams({
        q: query,
        l: location,
        sort: 'date',
        fromage: String(search.hoursOld ? Math.ceil(search.hoursOld / 24) : 3),
      })
      const domain = country.toLowerCase() === 'brazil' ? 'br.indeed.com' : 'indeed.com'
      const searchUrl = `https://${domain}/jobs?${params}`

      try {
        await sandbox.navigate(searchUrl)
        await sandbox.wait(2000)

        const page = sandbox.page as PlaywrightPage
        const extracted = (await page.evaluate(`(() => {
          const cards = Array.from(document.querySelectorAll('div[data-testid="slider_item"]'));
          const seen = new Set();
          const jobs = [];

          for (const card of cards) {
            const linkEl = card.querySelector('a.jcs-JobTitle[data-jk]') || card.querySelector('a[data-jk]');
            const jobKey = linkEl ? linkEl.getAttribute('data-jk') : '';

            if (!jobKey || seen.has(jobKey)) continue;
            seen.add(jobKey);

            const titleSpan = card.querySelector('h2.jobTitle span[title]') || card.querySelector('h2.jobTitle span');
            const companyEl = card.querySelector('[data-testid="company-name"]');
            const locationEl = card.querySelector('[data-testid="text-location"]');
            const salaryEl = card.querySelector('.salary-snippet-container span');

            const title = titleSpan ? (titleSpan.getAttribute('title') || titleSpan.textContent || '').trim() : '';
            const company = companyEl && companyEl.textContent ? companyEl.textContent.trim() : '';
            const location = locationEl && locationEl.textContent ? locationEl.textContent.trim() : '';
            const salary = salaryEl && salaryEl.textContent ? salaryEl.textContent.trim() : '';

            jobs.push({ jobKey, title, company, location, salary });
          }

          return jobs;
        })()`)) as Array<{ jobKey: string; title: string; company: string; location: string; salary: string }>

        const limited = extracted.slice(0, resultsWanted)
        let newCount = 0

        for (const item of limited) {
          const url = `https://${domain}/viewjob?jk=${item.jobKey}`
          const id = insertJob(db, {
            url,
            source: 'indeed',
            title: item.title,
            company: item.company,
            location: item.location || null,
            salary: item.salary || null,
            searchQuery: query,
          })

          if (id) {
            allNewIds.push(id)
            newCount++
          }
        }

        console.log(`[discover] ${newCount} novas vagas inseridas para '${query}'`)
      } catch (err) {
        console.error(`[discover] Erro ao processar busca '${query}':`, err)
      }

      await randomDelay(...DELAY_DISCOVER)
    }
  } finally {
    await sandbox.close()
  }

  return { jobIds: allNewIds }
}
