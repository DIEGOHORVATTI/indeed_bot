"""Thread-safe event bus for dashboard ↔ pipeline communication."""

from __future__ import annotations

import threading
import time
from collections import deque


class EventBus:
    """Singleton event bus. Pipeline emits events; dashboard consumes them."""

    _instance: EventBus | None = None
    _lock = threading.Lock()

    def __new__(cls) -> EventBus:
        with cls._lock:
            if cls._instance is None:
                inst = super().__new__(cls)
                inst._data_lock = threading.Lock()
                inst._events: deque[dict] = deque(maxlen=500)
                inst._counter = 0
                inst._screenshot_b64: str | None = None
                inst._dom_html: str | None = None
                inst._page_context: str | None = None
                inst._current_job: dict | None = None
                inst._pipeline_status = "idle"
                inst._paused = False
                inst._skip_requested = False
                cls._instance = inst
            return cls._instance

    # ── Emit / query ──

    def emit(self, event_type: str, data: dict | None = None) -> None:
        with self._data_lock:
            self._counter += 1
            self._events.append(
                {
                    "id": self._counter,
                    "type": event_type,
                    "data": data or {},
                    "ts": time.time(),
                }
            )

    def events_since(self, last_id: int = 0) -> list[dict]:
        with self._data_lock:
            return [e for e in self._events if e["id"] > last_id]

    # ── Screenshot ──

    def set_screenshot(self, b64: str) -> None:
        with self._data_lock:
            self._screenshot_b64 = b64

    def get_screenshot(self) -> str | None:
        with self._data_lock:
            return self._screenshot_b64

    # ── DOM ──

    def set_dom(self, html: str) -> None:
        with self._data_lock:
            self._dom_html = html

    def get_dom(self) -> str | None:
        with self._data_lock:
            return self._dom_html

    # ── Page context (structured view for AI) ──

    def set_page_context(self, ctx: str) -> None:
        with self._data_lock:
            self._page_context = ctx

    def get_page_context(self) -> str | None:
        with self._data_lock:
            return self._page_context

    # ── Current job ──

    def set_current_job(self, job: dict | None) -> None:
        with self._data_lock:
            self._current_job = job

    def get_current_job(self) -> dict | None:
        with self._data_lock:
            return self._current_job

    # ── Pipeline status ──

    def set_status(self, status: str) -> None:
        with self._data_lock:
            self._pipeline_status = status

    def get_status(self) -> str:
        with self._data_lock:
            return self._pipeline_status

    # ── User controls ──

    def pause(self) -> None:
        self._paused = True
        self.emit("control", {"action": "paused"})

    def resume(self) -> None:
        self._paused = False
        self.emit("control", {"action": "resumed"})

    def is_paused(self) -> bool:
        return self._paused

    def request_skip(self) -> None:
        self._skip_requested = True
        self.emit("control", {"action": "skip_requested"})

    def should_skip(self) -> bool:
        if self._skip_requested:
            self._skip_requested = False
            return True
        return False
