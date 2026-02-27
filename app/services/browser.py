from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from camoufox.sync_api import Camoufox

from app.models.config import CamoufoxConfig


def _build_proxy_kwargs(cfg: CamoufoxConfig) -> dict:
    if not cfg.proxy_server:
        return {}
    proxy_conf: dict = {"server": cfg.proxy_server}
    if cfg.proxy_username:
        proxy_conf["username"] = cfg.proxy_username
    if cfg.proxy_password:
        proxy_conf["password"] = cfg.proxy_password
    return {"proxy": proxy_conf}


@contextmanager
def create_browser(cfg: CamoufoxConfig) -> Iterator:
    proxy_kwargs = _build_proxy_kwargs(cfg)
    with Camoufox(
        user_data_dir=cfg.user_data_dir,
        persistent_context=True,
        **proxy_kwargs,
    ) as browser:
        yield browser
