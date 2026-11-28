import pytest
from app.core.cag_cache import CAGCache


@pytest.mark.asyncio
async def test_cag_retrieval_cache_and_invalidation():
    cache = CAGCache()
    ws = "507f1f77bcf86cd799439011"
    kb = "507f1f77bcf86cd799439012"

    params = dict(
        workspace_id=ws,
        kb_id=kb,
        query="  What is the   Return Policy? ",
        top_n=15,
        top_k=5,
        min_score_threshold=0.0,
        strategy="auto",
        vector_weight=0.6,
        text_weight=0.4,
        source_ids=None,
    )

    assert await cache.get_cached_retrieval(**params) is None
    assert cache.stats["retrieval_misses"] == 1

    payload = {"results": [{"chunkId": "c1", "text": "30-day returns"}], "citations": []}
    await cache.set_cached_retrieval(payload, **params)

    # Normalized query should hit
    hit_params = {**params, "query": "what is the return policy?"}
    hit = await cache.get_cached_retrieval(**hit_params)
    assert hit == payload
    assert cache.stats["retrieval_hits"] == 1

    # Invalidating KB bumps version and invalidates previous entries
    new_ver = await cache.invalidate_kb(ws, kb)
    assert new_ver == 2
    assert await cache.get_cached_retrieval(**hit_params) is None


@pytest.mark.asyncio
async def test_cag_chat_response_cache():
    cache = CAGCache()
    ws = "507f1f77bcf86cd799439011"
    kb = "507f1f77bcf86cd799439012"

    params = dict(
        workspace_id=ws,
        kb_id=kb,
        query="Summarize onboarding",
        model="gemini-2.5-flash",
        provider="gemini",
        custom_prompt=None,
        top_k=5,
        strategy="auto",
        min_score_threshold=0.0,
        source_ids=None,
        is_thinking=False,
    )

    assert await cache.get_cached_chat_response(**params) is None
    chat_payload = {
        "answer": "Onboarding takes 3 steps.",
        "citations": [{"index": 1, "title": "Guide"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    await cache.set_cached_chat_response(chat_payload, **params)

    cached = await cache.get_cached_chat_response(**params)
    assert cached == chat_payload
    assert cache.stats["chat_hits"] == 1
