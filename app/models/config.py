from __future__ import annotations

from pathlib import Path
from typing import Optional, List

import yaml
from pydantic import BaseModel, Field, ValidationError


class SearchConfig(BaseModel):
    base_url: str = Field(..., description="Indeed search URL with query params")
    base_urls: Optional[List[str]] = Field(None, description="Optional list of Indeed search URLs; if provided, supersedes base_url")
    start: int = Field(0, description="Pagination start index")
    end: int = Field(100, description="Pagination end index (inclusive)")


class CamoufoxConfig(BaseModel):
    user_data_dir: str = Field(..., description="Directory for Camoufox user data")
    language: str = Field("us", description="Locale/country code, e.g. us, uk, fr")
    proxy_server: Optional[str] = Field(
        None,
        description="Proxy server URL, e.g. http://host:port or socks5://host:port",
    )
    proxy_username: Optional[str] = Field(None, description="Proxy username")
    proxy_password: Optional[str] = Field(None, description="Proxy password")


class PersonalizationConfig(BaseModel):
    enabled: bool = Field(False, description="Enable AI-tailored CV/cover letter per job")
    base_cv_path: str = Field("assets/base_cv.md", description="Path to base CV markdown")
    base_cover_letter_path: str = Field("assets/base_cover_letter.md", description="Path to base cover letter markdown")
    claude_cli_path: str = Field("claude", description="Path to claude CLI binary")
    output_dir: str = Field("output", description="Directory to save generated PDFs")


class AppConfig(BaseModel):
    search: SearchConfig
    camoufox: CamoufoxConfig
    personalization: PersonalizationConfig = PersonalizationConfig()

    @classmethod
    def load(cls, path: str | Path = "config.yaml") -> "AppConfig":
        path = Path(path)
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        try:
            return cls(**data)
        except ValidationError as e:
            # Re-raise with clearer context
            raise ValueError(f"Invalid configuration in {path} -> {e}") from e
