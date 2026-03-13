import { BotStatus } from '../types';

type ExtensionMessage =
  | {
      type: 'ext:status';
      payload: {
        state: string;
        appliedCount: number;
        skippedCount: number;
        failedCount: number;
        pendingJobs: number;
        totalJobs: number;
        currentJob?: string;
      };
    }
  | {
      type: 'ext:screenshot';
      payload: {
        screenshot: string;
        url: string;
        pageContext: string;
        timestamp: number;
      };
    }
  | {
      type: 'ext:job:discovered';
      payload: {
        jobs: Array<{
          url: string;
          jobKey: string;
          title?: string;
          company?: string;
          location?: string;
          salary?: string;
          source: string;
        }>;
      };
    }
  | {
      type: 'ext:job:applied';
      payload: {
        jobKey: string;
        title: string;
        company: string;
      };
    }
  | {
      type: 'ext:job:failed';
      payload: {
        jobKey: string;
        reason: string;
      };
    }
  | {
      type: 'ext:log';
      payload: {
        level: string;
        message: string;
        timestamp: number;
      };
    };

export type BackendMessage =
  | {
      type: 'cmd:start';
      payload: {
        searchUrls: string[];
        maxApplies: number;
      };
    }
  | { type: 'cmd:stop' }
  | { type: 'cmd:pause' }
  | { type: 'cmd:resume' }
  | {
      type: 'cmd:apply';
      payload: {
        jobId: number;
        url: string;
        title: string;
        company: string;
        cvPdfUrl?: string;
        coverPdfUrl?: string;
      };
    };

let socket: WebSocket | null = null;
let socketUrl = '';
let reconnectDelayMs = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualDisconnect = false;
let messageQueue: ExtensionMessage[] = [];
let commandHandler: ((msg: BackendMessage) => void) | null = null;

function toWsUrl(backendUrl: string): string {
  const parsed = new URL(backendUrl);
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  parsed.pathname = '/ws/extension';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function scheduleReconnect(): void {
  if (manualDisconnect || reconnectTimer || !socketUrl) return;
  const wait = reconnectDelayMs;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, wait);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
}

function flushQueue(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  while (messageQueue.length > 0 && socket.readyState === WebSocket.OPEN) {
    const next = messageQueue.shift();
    if (!next) break;
    socket.send(JSON.stringify(next));
  }
}

function enqueueMessage(message: ExtensionMessage): void {
  if (messageQueue.length >= 50) {
    messageQueue = messageQueue.slice(-49);
  }
  messageQueue.push(message);
}

function sendMessage(message: ExtensionMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return;
  }
  enqueueMessage(message);
}

function connect(): void {
  if (!socketUrl) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(socketUrl);
  console.log('[ws-bridge] connecting', socketUrl);

  socket.onopen = () => {
    reconnectDelayMs = 1000;
    console.log('[ws-bridge] connected');
    flushQueue();
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as BackendMessage;
      if (commandHandler) {
        commandHandler(msg);
      }
    } catch {}
  };

  socket.onclose = () => {
    console.log('[ws-bridge] disconnected');
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    console.log('[ws-bridge] error');
  };
}

export function initBridge(backendUrl: string): void {
  manualDisconnect = false;
  const nextUrl = toWsUrl(backendUrl);
  const changed = socketUrl !== nextUrl;
  socketUrl = nextUrl;

  if (changed && socket) {
    try {
      socket.close();
    } catch {}
    socket = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connect();
}

export function sendStatus(status: BotStatus): void {
  sendMessage({
    type: 'ext:status',
    payload: {
      state: status.state,
      appliedCount: status.appliedCount,
      skippedCount: status.skippedCount,
      failedCount: status.failedCount,
      pendingJobs: status.pendingJobs,
      totalJobs: status.totalJobs,
      currentJob: status.currentJob
    }
  });
}

export function sendScreenshot(data: { screenshot: string; url: string; pageContext: string }): void {
  sendMessage({
    type: 'ext:screenshot',
    payload: {
      screenshot: data.screenshot,
      url: data.url,
      pageContext: data.pageContext,
      timestamp: Date.now()
    }
  });
}

export function sendJobDiscovered(
  jobs: Array<{ url: string; jobKey: string; title?: string; company?: string; location?: string; salary?: string; source: string }>
): void {
  sendMessage({
    type: 'ext:job:discovered',
    payload: { jobs }
  });
}

export function sendJobApplied(jobKey: string, title: string, company: string): void {
  sendMessage({
    type: 'ext:job:applied',
    payload: { jobKey, title, company }
  });
}

export function sendJobFailed(jobKey: string, reason: string): void {
  sendMessage({
    type: 'ext:job:failed',
    payload: { jobKey, reason }
  });
}

export function sendLog(level: string, message: string): void {
  sendMessage({
    type: 'ext:log',
    payload: {
      level,
      message,
      timestamp: Date.now()
    }
  });
}

export function onCommand(handler: (msg: BackendMessage) => void): void {
  commandHandler = handler;
}

export function isConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

export function disconnect(): void {
  manualDisconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    try {
      socket.close();
    } catch {}
    socket = null;
  }

  console.log('[ws-bridge] disconnected by client');
}
