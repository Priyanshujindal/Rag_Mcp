"""
app/services/image_generator.py
===============================
Image generation service with Cloudflare Workers AI (primary), Replicate, and Pollinations fallback.
Priority: Cloudflare Flux → Replicate Flux Schnell → Pollinations Flux → SVG placeholder.
"""

from __future__ import annotations

import base64
import urllib.parse
from typing import Dict, Any, Tuple
import httpx

from app.core.config import get_settings
from app.core.logging import logger


class ImageGenerator:
    """
    Service for generating images with Cloudflare Workers AI as primary,
    Replicate Flux Schnell as secondary, and Pollinations as resilient fallback.
    """

    REPLICATE_URL = "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions"
    POLLINATIONS_URL = "https://image.pollinations.ai/prompt"
    CF_BASE = "https://api.cloudflare.com/client/v4/accounts"
    CF_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell"

    @classmethod
    async def generate_image(
        cls,
        prompt: str,
        aspect_ratio: str = "1:1",
        output_format: str = "webp",
    ) -> Tuple[bytes, str, Dict[str, Any]]:
        """
        Generates an image from a prompt.
        Returns:
            (image_bytes, mime_type, metadata_dict)
        """
        settings = get_settings()
        if not settings.CLOUDFLARE_API_TOKEN or not settings.CLOUDFLARE_ACCOUNT_ID:
            from app.core.config import reset_settings
            reset_settings()
            settings = get_settings()

        clean_prompt = prompt.strip()
        if not clean_prompt:
            clean_prompt = "A high-quality digital masterpiece"

        # Truncate prompt if overly long for model safety
        if len(clean_prompt) > 1000:
            clean_prompt = clean_prompt[:1000]

        cf_token = settings.CLOUDFLARE_API_TOKEN.strip() if settings.CLOUDFLARE_API_TOKEN else ""
        cf_acct = settings.CLOUDFLARE_ACCOUNT_ID.strip() if settings.CLOUDFLARE_ACCOUNT_ID else ""

        # Direct fallback from os.environ or .env files if pydantic singleton was cached in running process
        if not cf_token or not cf_acct:
            import os
            from pathlib import Path
            cf_token = cf_token or os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
            cf_acct = cf_acct or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
            if not cf_token or not cf_acct:
                for env_candidate in (
                    Path(__file__).resolve().parents[4] / ".env",
                    Path(__file__).resolve().parents[2] / ".env",
                ):
                    if env_candidate.exists():
                        try:
                            for eline in env_candidate.read_text(encoding="utf-8").splitlines():
                                eline = eline.strip()
                                if eline.startswith("CLOUDFLARE_API_TOKEN="):
                                    cf_token = cf_token or eline.split("=", 1)[1].strip().strip("\"'")
                                elif eline.startswith("CLOUDFLARE_ACCOUNT_ID="):
                                    cf_acct = cf_acct or eline.split("=", 1)[1].strip().strip("\"'")
                        except Exception:
                            pass

        replicate_key = settings.REPLICATE_API_KEY.strip() if settings.REPLICATE_API_KEY else ""

        # 1. Cloudflare Workers AI — Flux 1 Schnell (primary, free tier)
        if cf_token and cf_acct:
            cf_models_to_try = [
                cls.CF_IMAGE_MODEL,
                "@cf/black-forest-labs/flux-2-klein-4b",
                "@cf/leonardo/phoenix-1.0",
            ]
            for current_cf_model in cf_models_to_try:
                try:
                    cf_url = f"{cls.CF_BASE}/{cf_acct}/ai/run/{current_cf_model}"
                    cf_headers = {
                        "Authorization": f"Bearer {cf_token}",
                        "Content-Type": "application/json",
                    }
                    cf_payload = {"prompt": clean_prompt, "steps": 4}
                    timeout = httpx.Timeout(connect=15.0, read=90.0, write=15.0, pool=15.0)
                    async with httpx.AsyncClient(timeout=timeout) as client:
                        cf_resp = await client.post(cf_url, json=cf_payload, headers=cf_headers)
                        if cf_resp.status_code == 200:
                            content_type = cf_resp.headers.get("content-type", "")
                            if "application/json" in content_type:
                                data = cf_resp.json()
                                result = data.get("result", data)
                                b64_img = result.get("image") if isinstance(result, dict) else None
                                if b64_img:
                                    img_bytes = base64.b64decode(b64_img)
                                    if len(img_bytes) > 100:
                                        mime = "image/jpeg" if img_bytes.startswith(b"\xff\xd8") else "image/png"
                                        logger.info(f"Generated image via Cloudflare ({current_cf_model}, {len(img_bytes)} bytes)")
                                        return (
                                            img_bytes,
                                            mime,
                                            {
                                                "engine": f"cloudflare/{current_cf_model.split('/')[-1]}",
                                                "model": current_cf_model,
                                                "prompt": clean_prompt,
                                                "status": "ready",
                                            },
                                        )
                            elif len(cf_resp.content) > 100:
                                img_bytes = cf_resp.content
                                mime = "image/jpeg" if img_bytes.startswith(b"\xff\xd8") else "image/png"
                                logger.info(f"Generated image via Cloudflare ({current_cf_model}, {len(img_bytes)} bytes)")
                                return (
                                    img_bytes,
                                    mime,
                                    {
                                        "engine": f"cloudflare/{current_cf_model.split('/')[-1]}",
                                        "model": current_cf_model,
                                        "prompt": clean_prompt,
                                        "status": "ready",
                                    },
                                )
                        else:
                            logger.warning(
                                f"Cloudflare model {current_cf_model} returned {cf_resp.status_code}: {cf_resp.text[:150]}. Trying next."
                            )
                except Exception as cf_exc:
                    logger.warning(f"Cloudflare generation with {current_cf_model} failed ({cf_exc}). Trying next.")

        # 2. Attempt Replicate (Flux Schnell) if API key is provided
        if replicate_key:
            try:
                headers = {
                    "Authorization": f"Bearer {replicate_key}",
                    "Content-Type": "application/json",
                    "Prefer": "wait=60",
                }
                payload = {
                    "input": {
                        "prompt": clean_prompt,
                        "num_outputs": 1,
                        "aspect_ratio": aspect_ratio,
                        "output_format": output_format,
                    }
                }
                timeout = httpx.Timeout(connect=15.0, read=90.0, write=15.0, pool=15.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(cls.REPLICATE_URL, json=payload, headers=headers)
                    if resp.status_code in (200, 201):
                        data = resp.json()
                        output = data.get("output")
                        # Output can be a list of URLs or a single URL
                        img_url = output[0] if isinstance(output, list) and output else output
                        if img_url and isinstance(img_url, str):
                            img_resp = await client.get(img_url)
                            if img_resp.status_code == 200 and len(img_resp.content) > 100:
                                logger.info(f"Successfully generated image via Replicate Flux Schnell ({len(img_resp.content)} bytes)")
                                return (
                                    img_resp.content,
                                    f"image/{output_format}",
                                    {
                                        "engine": "replicate/black-forest-labs/flux-schnell",
                                        "model": "black-forest-labs/flux-schnell",
                                        "prompt": clean_prompt,
                                        "status": "ready",
                                    },
                                )
                    else:
                        logger.warning(
                            f"Replicate API returned {resp.status_code}: {resp.text[:150]}. Falling back to Flux engine."
                        )
            except Exception as exc:
                logger.warning(f"Replicate generation failed ({exc}), falling back to secondary Flux engine.")

        # 2. Resilient Flux Fallback (Pollinations AI Flux)
        try:
            encoded = urllib.parse.quote(clean_prompt)
            fallback_url = f"{cls.POLLINATIONS_URL}/{encoded}?width=1024&height=1024&nologo=true&model=flux"
            timeout = httpx.Timeout(connect=15.0, read=60.0, write=15.0, pool=15.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                fb_resp = await client.get(fallback_url)
                if fb_resp.status_code == 200 and len(fb_resp.content) > 100:
                    logger.info(f"Generated image via Flux fallback engine ({len(fb_resp.content)} bytes)")
                    return (
                        fb_resp.content,
                        "image/jpeg",
                        {
                            "engine": "flux (fallback)",
                            "model": "black-forest-labs/flux",
                            "prompt": clean_prompt,
                            "status": "ready",
                        },
                    )
        except Exception as fb_exc:
            logger.error(f"Flux fallback also failed: {fb_exc}")

        # 3. If both failed, generate a clean placeholder SVG image
        placeholder_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="50%" stop-color="#312e81"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <circle cx="400" cy="350" r="120" fill="none" stroke="#6366f1" stroke-width="6" opacity="0.8"/>
  <path d="M 330 400 L 400 300 L 470 400 Z" fill="#818cf8" opacity="0.6"/>
  <circle cx="450" cy="270" r="24" fill="#f43f5e"/>
  <text x="400" y="550" fill="#f8fafc" font-size="26" font-weight="bold" font-family="system-ui, sans-serif" text-anchor="middle">Image Generation</text>
  <text x="400" y="590" fill="#94a3b8" font-size="16" font-family="system-ui, sans-serif" text-anchor="middle">{clean_prompt[:45]}...</text>
</svg>"""
        return (
            placeholder_svg.encode("utf-8"),
            "image/svg+xml",
            {
                "engine": "placeholder/svg",
                "model": "fallback",
                "prompt": clean_prompt,
                "status": "placeholder",
            },
        )
