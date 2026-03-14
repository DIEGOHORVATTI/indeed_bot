let activeTabId: number | null = null

export async function createTab(url: string): Promise<{ tabId: number }> {
  const tab = await chrome.tabs.create({ url, active: true })
  activeTabId = tab.id!
  return { tabId: tab.id! }
}

export async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId)
    if (activeTabId === tabId) activeTabId = null
  } catch {}
}

export async function navigateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url, active: true })
}

export async function waitForTabLoad(tabId: number, timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false

    const done = (result: boolean) => {
      if (resolved) return
      resolved = true
      chrome.tabs.onUpdated.removeListener(listener)
      resolve(result)
    }

    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        done(true)
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => done(false), timeoutMs)
  })
}

export function getActiveTabId(): number | null {
  return activeTabId
}
