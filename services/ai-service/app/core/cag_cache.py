"""
app/core/cag_cache.py
=====================
Cache-Augmented Generation (CAG) layer backed by Redis (when REDIS_URL is set
and reachable) with automatic in-memory TTL fallback for local dev and tests.

Caches:
1. Hybrid retrieval results (embeddings + vector/BM25 + reranked passages)
2. Full RAG chat responses (answer + citations + usage) for eligible queries

Invalidation uses per-(workspace, knowledgeBase) version counters (O(1), no key scans).
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.core.logging import logger


def _normalize_query(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _hash_payload(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


class CAGCache:
    """Async Redis + in-memory fallback cache for RAG retrieval and CAG responses."""

    def __init__(self) -> None:
        self._redis: Optional[aioredis.Redis] = None
        self._redis_checked: bool = False
        self._mem_kv: Dict[str, tuple[str, Optional[float]]] = {}
        self._mem_versions: Dict[str, int] = {}
        self.stats: Dict[str, int] = {
            "retrieval_hits": 0,
            "retrieval_misses": 0,
            "chat_hits": 0,
            "chat_misses": 0,
            "invalidations": 0,
        }

    async def _get_redis(self) -> Optional[aioredis.Redis]:
        settings = get_settings()
        if not settings.REDIS_URL:
            return None

        if self._redis is not None:
            return self._redis

        if self._redis_checked:
            return None

        self._redis_checked = True
        try:
            client = aioredis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2.0,
                socket_timeout=2.0,
            )
            await client.ping()
            self._redis = client
            logger.info("CAG Redis cache connected")
            return self._redis
        except Exception as exc:
            logger.warning(f"CAG Redis unavailable ({exc}); using in-memory TTL fallback")
            self._redis = None
            return None

    def _mem_get(self, key: str) -> Optional[str]:
        entry = self._mem_kv.get(key)
        if not entry:
            return None
        val, expires_at = entry
        if expires_at is not None and expires_at <= time.time():
            self._mem_kv.pop(key, None)
            return None
        return val

    def _mem_set(self, key: str, value: str, ttl_seconds: int) -> None:
        expires_at = (time.time() + ttl_seconds) if ttl_seconds > 0 else None
        self._mem_kv[key] = (value, expires_at)

    async def _get_json(self, key: str) -> Optional[Dict[str, Any]]:
        client = await self._get_redis()
        if client is not None:
            try:
                raw = await client.get(key)
                return json.loads(raw) if raw else None
            except Exception as exc:
                logger.warning(f"Redis get failed for {key}: {exc}")

        raw = self._mem_get(key)
        return json.loads(raw) if raw else None

    async def _set_json(self, key: str, value: Dict[str, Any], ttl_seconds: int) -> None:
        raw = json.dumps(value, default=str)
        client = await self._get_redis()
        if client is not None:
            try:
                await client.set(key, raw, ex=ttl_seconds)
                return
            except Exception as exc:
                logger.warning(f"Redis set failed for {key}: {exc}")

        self._mem_set(key, raw, ttl_seconds)

    async def get_kb_version(self, workspace_id: str, kb_id: str) -> int:
        ver_key = f"cag:kb_ver:{workspace_id}:{kb_id}"
        client = await self._get_redis()
        if client is not None:
            try:
                val = await client.get(ver_key)
                return int(val) if val else 1
            except Exception:
                pass
        return self._mem_versions.get(ver_key, 1)

    async def invalidate_kb(self, workspace_id: str, kb_id: str) -> int:
        """Bump KB version counter so all prior retrieval & CAG chat entries become unreachable."""
        self.stats["invalidations"] += 1
        ver_key = f"cag:kb_ver:{workspace_id}:{kb_id}"
        client = await self._get_redis()
        if client is not None:
            try:
                new_ver = await client.incr(ver_key)
                return int(new_ver)
            except Exception:
                pass

        new_ver = self._mem_versions.get(ver_key, 1) + 1
        self._mem_versions[ver_key] = new_ver
        return new_ver

    async def _retrieval_key(
        self,
        workspace_id: str,
        kb_id: str,
        query: str,
        top_n: int,
        top_k: int,
        min_score_threshold: float,
        strategy: str,
        vector_weight: float,
        text_weight: float,
        source_ids: Optional[List[str]],
    ) -> str:
        kb_ver = await self.get_kb_version(workspace_id, kb_id)
        digest = _hash_payload({
            "q": _normalize_query(query),
            "top_n": top_n,
            "top_k": top_k,
            "min_score": min_score_threshold,
            "strategy": strategy,
            "vw": vector_weight,
            "tw": text_weight,
            "sources": sorted(source_ids) if source_ids else [],
        })
        return f"cag:ret:{workspace_id}:{kb_id}:v{kb_ver}:{digest}"

    async def get_cached_retrieval(self, **kwargs: Any) -> Optional[Dict[str, Any]]:
        settings = get_settings()
        if not settings.CAG_ENABLED:
            return None
        key = await self._retrieval_key(**kwargs)
        hit = await self._get_json(key)
        if hit is not None:
            self.stats["retrieval_hits"] += 1
        else:
            self.stats["retrieval_misses"] += 1
        return hit

    async def set_cached_retrieval(self, payload: Dict[str, Any], **kwargs: Any) -> None:
        settings = get_settings()
        if not settings.CAG_ENABLED:
            return
        key = await self._retrieval_key(**kwargs)
        await self._set_json(key, payload, settings.CAG_RETRIEVAL_TTL_SECONDS)

    async def _chat_key(
        self,
        workspace_id: str,
        kb_id: str,
        query: str,
        model: Optional[str],
        provider: Optional[str],
        custom_prompt: Optional[str],
        top_k: int,
        strategy: str,
        min_score_threshold: float,
        source_ids: Optional[List[str]],
        is_thinking: bool,
    ) -> str:
        kb_ver = await self.get_kb_version(workspace_id, kb_id)
        digest = _hash_payload({
            "q": _normalize_query(query),
            "model": model or "",
            "provider": provider or "",
            "custom_prompt": (custom_prompt or "").strip(),
            "top_k": top_k,
            "strategy": strategy,
            "min_score": min_score_threshold,
            "sources": sorted(source_ids) if source_ids else [],
            "thinking": is_thinking,
        })
        return f"cag:chat:{workspace_id}:{kb_id}:v{kb_ver}:{digest}"

    async def get_cached_chat_response(self, **kwargs: Any) -> Optional[Dict[str, Any]]:
        settings = get_settings()
        if not settings.CAG_ENABLED:
            return None
        key = await self._chat_key(**kwargs)
        hit = await self._get_json(key)
        if hit is not None:
            self.stats["chat_hits"] += 1
        else:
            self.stats["chat_misses"] += 1
        return hit

    async def set_cached_chat_response(self, payload: Dict[str, Any], **kwargs: Any) -> None:
        settings = get_settings()
        if not settings.CAG_ENABLED:
            return
        key = await self._chat_key(**kwargs)
        await self._set_json(key, payload, settings.CAG_RESPONSE_TTL_SECONDS)


cag_cache = CAGCache()
