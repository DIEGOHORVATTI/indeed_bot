/**
 * Tab group management for Indeed Auto Apply.
 * Runs all bot tabs in a dedicated Chrome tab group.
 */

let groupId: number | null = null;

export async function createTabGroup(url: string): Promise<{ tabId: number; groupId: number }> {
  const tab = await chrome.tabs.create({ url, active: false });
  const gId = await chrome.tabs.group({ tabIds: [tab.id!] });
  await chrome.tabGroups.update(gId, {
    title: 'Indeed Apply',
    color: 'blue',
    collapsed: false
  });
  groupId = gId;
  return { tabId: tab.id!, groupId: gId };
}

export async function addTabToGroup(url: string): Promise<number> {
  const tab = await chrome.tabs.create({ url, active: false });
  if (groupId !== null) {
    await chrome.tabs.group({ tabIds: [tab.id!], groupId });
  }
  return tab.id!;
}

export async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* tab may already be closed */
  }
}

export async function navigateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
}

export async function waitForTabLoad(tabId: number, timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const done = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(result);
    };

    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        done(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => done(false), timeoutMs);
  });
}

export function getGroupId(): number | null {
  return groupId;
}

export function resetGroup(): void {
  groupId = null;
}
