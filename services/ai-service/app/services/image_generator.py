"""
app/services/image_generator.py
===============================
Image generation service using Replicate (Flux Schnell) with automatic resilient fallback.
Generates high-fidelity visual artwork from natural language prompts.
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
    Service for generating images via Replicate's Flux model, with graceful fallback.
    """

    REPLICATE_URL = "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions"
    POLLINATIONS_URL = "https://image.pollinations.ai/prompt"

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
        clean_prompt = prompt.strip()
        if not clean_prompt:
            clean_prompt = "A high-quality digital masterpiece"

        # Truncate prompt if overly long for model safety
        if len(clean_prompt) > 1000:
            clean_prompt = clean_prompt[:1000]

        replicate_key = settings.REPLICATE_API_KEY.strip() if settings.REPLICATE_API_KEY else ""

        # 1. Attempt Replicate (Flux Schnell) if API key is provided
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
