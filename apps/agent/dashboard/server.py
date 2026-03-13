"""FastAPI dashboard server for the sandbox monitor."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

from apps.agent.dashboard.events import EventBus

DASHBOARD_PORT = 8080

app = FastAPI(title="JobPilot Sandbox")
_events = EventBus()


@app.get("/")
async def index():
    html = (Path(__file__).parent / "static" / "monitor.html").read_text("utf-8")
    return HTMLResponse(html)


@app.get("/api/state")
async def state():
    return JSONResponse(
        {
            "screenshot": _events.get_screenshot(),
            "dom": _events.get_dom(),
            "context": _events.get_page_context(),
            "job": _events.get_current_job(),
            "status": _events.get_status(),
            "paused": _events.is_paused(),
        }
    )


@app.get("/api/dom")
async def dom():
    return JSONResponse({"dom": _events.get_dom()})


@app.get("/api/context")
async def context():
    return JSONResponse({"context": _events.get_page_context()})


@app.post("/api/control/{action}")
async def control(action: str):
    if action == "pause":
        _events.pause()
    elif action == "resume":
        _events.resume()
    elif action == "skip":
        _events.request_skip()
    return {"ok": True}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    last_id = 0
    last_screenshot_ts = 0.0

    try:
        while True:
            # Stream new events
            for ev in _events.events_since(last_id):
                await ws.send_json(ev)
                last_id = ev["id"]

            # Stream screenshot at ~2 fps
            now = time.time()
            if now - last_screenshot_ts > 0.5:
                b64 = _events.get_screenshot()
                if b64:
                    await ws.send_json({"type": "_frame", "data": {"b64": b64}})
                last_screenshot_ts = now

            # Stream status
            await ws.send_json(
                {
                    "type": "_status",
                    "data": {
                        "status": _events.get_status(),
                        "paused": _events.is_paused(),
                        "job": _events.get_current_job(),
                    },
                }
            )

            await asyncio.sleep(0.4)
    except (WebSocketDisconnect, Exception):
        pass


def start_dashboard(port: int = DASHBOARD_PORT) -> threading.Thread:
    """Launch the dashboard in a daemon thread. Returns the thread."""
    import uvicorn

    t = threading.Thread(
        target=uvicorn.run,
        kwargs={"app": app, "host": "0.0.0.0", "port": port, "log_level": "warning"},
        daemon=True,
    )
    t.start()
    return t
