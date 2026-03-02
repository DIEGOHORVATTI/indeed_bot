/**
 * Push notification utilities for user input needed scenarios.
 */

const pendingNotifications = new Map<string, number>(); // notifId -> tabId

export async function notifyUserInput(
  jobTitle: string,
  fieldLabel: string,
  tabId: number
): Promise<void> {
  if (!chrome.notifications) return;

  const notifId = `indeed-input-${Date.now()}`;

  try {
    await chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: 'Indeed Apply — Input Needed',
      message: `Cannot answer: "${fieldLabel}"${jobTitle ? ` for ${jobTitle}` : ''}`,
      requireInteraction: true,
      priority: 2
    });

    pendingNotifications.set(notifId, tabId);
  } catch (err) {
    console.warn('Failed to create notification:', err);
  }
}

export function setupNotificationListeners(): void {
  if (!chrome.notifications) return;

  // Handle notification click — focus the tab
  chrome.notifications.onClicked.addListener((notifId) => {
    const tabId = pendingNotifications.get(notifId);
    if (tabId) {
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.getAll({ populate: false }, (windows) => {
        for (const w of windows) {
          chrome.tabs.query({ windowId: w.id }, (tabs) => {
            if (tabs.some((t) => t.id === tabId)) {
              chrome.windows.update(w.id!, { focused: true });
            }
          });
        }
      });
      pendingNotifications.delete(notifId);
      chrome.notifications.clear(notifId);
    }
  });

  // Clean up on notification close
  chrome.notifications.onClosed.addListener((notifId) => {
    pendingNotifications.delete(notifId);
  });
}
