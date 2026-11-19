"""
app/rag/vector_store.py
=======================
Abstract VectorStore interface + AtlasVectorStore implementation.

IMPORTANT: This is the ONLY module that may build $vectorSearch or $search
           pipeline stages. No other module may construct those stages directly.
           This abstraction exists so the backing store (Atlas) can be swapped
           later without touching any other module.

Atlas note: Both `chunks_vector` (vectorSearch index) and `chunks_text` (search
index) MUST include workspaceId (and optionally knowledgeBaseId / sourceId) in
their filter fields definitions so we can push the tenant-isolation filter
INSIDE the stage, not as a post-filter.  Post-filtering would still work for
correctness but would cause Atlas to retrieve far more candidates than needed.

$rankFusion auto-probe:
  On first hybrid_search call with strategy="auto" we try $rankFusion against
  Atlas.  If the cluster rejects it (older Atlas tier / plan doesn't support it)
  we fall back to the manual RRF implementation and remember that decision for
  the lifetime of the process.  We never crash — we just log a one-time warning.
"""

from __future__ import annotations

import abc
import asyncio
import logging
from typing import Any

from bson import ObjectId
from pymongo import AsyncMongoClient

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentinel: has the $rankFusion probe run yet?
# ---------------------------------------------------------------------------
_rankfusion_supported: bool | None = None  # None = not probed yet
_rankfusion_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------

class VectorStore(abc.ABC):
    """
    Abstract interface for all vector/text/hybrid search operations.

    Every method requires workspace_id and (where relevant) kb_id so that
    tenant isolation is enforced inside the query stage, never as a
    post-stage filter.
    """

    @abc.abstractmethod
    async def vector_search(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_embedding: list[float],
        top_n: int = 20,
        source_ids: list[ObjectId] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Dense ANN search via the Atlas Vector Search index (chunks_vector).
        Each returned dict includes the original chunk fields plus:
            vectorScore  (float, 0-1)
            vectorRank   (int, 1-based position in this result list)
        """
        ...

    @abc.abstractmethod
    async def text_search(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_text: str,
        top_n: int = 20,
        source_ids: list[ObjectId] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Full-text search via the Atlas Search index (chunks_text).
        Each returned dict includes the original chunk fields plus:
            textScore    (float)
            textRank     (int, 1-based position in this result list)
        """
        ...

    @abc.abstractmethod
    async def hybrid_search(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_embedding: list[float],
        query_text: str,
        top_n: int = 20,
        strategy: str = "auto",
        vector_weight: float = 0.6,
        text_weight: float = 0.4,
        source_ids: list[ObjectId] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Hybrid search combining dense vector retrieval + full-text BM25.
        Each returned dict includes the original chunk fields plus:
            vectorScore, textScore, vectorRank, textRank, fusedScore
        strategy: "auto" | "rankfusion" | "manual"
        """
        ...

    @abc.abstractmethod
    async def delete_by_source(
        self,
        workspace_id: ObjectId,
        source_id: ObjectId,
    ) -> int:
        """Delete all chunks for a given source. Returns count deleted."""
        ...

    @abc.abstractmethod
    async def delete_by_knowledge_base(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId,
    ) -> int:
        """Delete all chunks for a given knowledge base. Returns count deleted."""
        ...

    @abc.abstractmethod
    async def count(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None = None,
    ) -> int:
        """Count chunks for a workspace (optionally scoped to a knowledge base)."""
        ...


# ---------------------------------------------------------------------------
# Atlas implementation
# ---------------------------------------------------------------------------

class AtlasVectorStore(VectorStore):
    """
    MongoDB Atlas-backed VectorStore.

    Uses:
      - `chunks_vector`  Atlas Vector Search index  (cosine, 384 dims)
      - `chunks_text`    Atlas Search index          (BM25 text + objectId filters)

    All query stages embed the workspaceId filter INSIDE the stage so Atlas
    uses the index filter rather than a post-stage match.
    """

    VECTOR_INDEX = "chunks_vector"
    TEXT_INDEX = "chunks_text"
    COLLECTION = "chunks"

    def __init__(self, client: AsyncMongoClient, db_name: str):
        self._client = client
        self._db_name = db_name

    @property
    def _collection(self):
        return self._client[self._db_name][self.COLLECTION]

    # ------------------------------------------------------------------
    # Helpers -- build filter dicts injected INSIDE search stages
    # ------------------------------------------------------------------

    @staticmethod
    def _vector_filter(
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        source_ids: list[ObjectId] | None,
    ) -> dict[str, Any]:
        """
        Filter dict for the $vectorSearch `filter` field.
        These fields must be declared as `filter` fields in the vector index.
        """
        f: dict[str, Any] = {"workspaceId": {"$eq": workspace_id}}
        if kb_id is not None:
            f["knowledgeBaseId"] = {"$eq": kb_id}
        if source_ids:
            f["sourceId"] = {"$in": source_ids}
        return f

    @staticmethod
    def _text_filter(
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        source_ids: list[ObjectId] | None,
    ) -> dict[str, Any]:
        """
        Compound filter clause for the $search `compound.filter` list.
        objectId filters inside Atlas Search must use the `equals` operator.
        """
        must_clauses: list[dict] = [
            {"equals": {"path": "workspaceId", "value": workspace_id}},
        ]
        if kb_id is not None:
            must_clauses.append(
                {"equals": {"path": "knowledgeBaseId", "value": kb_id}}
            )
        if source_ids:
            # Atlas Search equals doesn't support $in natively for objectId;
            # use compound.should with minimumShouldMatch instead.
            source_clauses = [
                {"equals": {"path": "sourceId", "value": sid}}
                for sid in source_ids
            ]
            must_clauses.append(
                {"compound": {"should": source_clauses, "minimumShouldMatch": 1}}
            )
        return {"compound": {"filter": must_clauses}}

    # ------------------------------------------------------------------
    # vector_search
    # ------------------------------------------------------------------

    async def vector_search(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_embedding: list[float],
        top_n: int = 20,
        source_ids: list[ObjectId] | None = None,
    ) -> list[dict[str, Any]]:
        """
        $vectorSearch stage -- MUST include workspaceId inside the stage filter.
        Returns chunks with an added `vectorScore` and `vectorRank` field.
        """
        pipeline = [
            {
                "$vectorSearch": {
                    "index": self.VECTOR_INDEX,
                    "path": "embedding",
                    "queryVector": query_embedding,
                    "numCandidates": min(top_n * 10, 500),
                    "limit": top_n,
                    "filter": self._vector_filter(workspace_id, kb_id, source_ids),
                }
            },
            {
                "$addFields": {
                    "vectorScore": {"$meta": "vectorSearchScore"},
                }
            },
            {
                "$project": {
                    "embedding": 0,  # Never return the raw vector -- saves bandwidth
                }
            },
        ]
        docs = await (await self._collection.aggregate(pipeline)).to_list(length=top_n)

        # Tag with 1-based rank in this result list
        for rank, doc in enumerate(docs, start=1):
            doc["vectorRank"] = rank
            # Ensure ObjectId fields survive JSON serialisation downstream
            _stringify_ids(doc)

        return docs

    # ------------------------------------------------------------------
    # text_search
    # ------------------------------------------------------------------

    async def text_search(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_text: str,
        top_n: int = 20,
        source_ids: list[ObjectId] | None = None,
    ) -> list[dict[str, Any]]:
        """
        $search stage using the Atlas Search (BM25) index.
        workspaceId filter is embedded INSIDE the compound stage.
        Returns chunks with an added `textScore` and `textRank` field.
        """
        # Build compound query: must (text match) + filter (tenant isolation)
        text_filter = self._text_filter(workspace_id, kb_id, source_ids)
        pipeline = [
            {
                "$search": {
                    "index": self.TEXT_INDEX,
                    "compound": {
                        "must": [
                            {
                                "text": {
                                    "query": query_text,
                                    "path": ["text", "metadata.title"],
                                    "fuzzy": {"maxEdits": 1},
                                }
                            }
                        ],
                        "filter": text_filter["compound"]["filter"],
                    },
                    "scoreDetails": False,
                }
            },
            {"$limit": top_n},
            {
                "$addFields": {
                    "textScore": {"$meta": "searchScore"},
                }
            },
            {
                "$project": {
                    "embedding": 0,
                }
            },
        ]
        docs = await (await self._collection.aggregate(pipeline)).to_list(length=top_n)

        for rank, doc in enumerate(docs, start=1):
            doc["textRank"] = rank
            _stringify_ids(doc)

        return docs

    # ------------------------------------------------------------------
    # hybrid_search
    # ------------------------------------------------------------------

    async def hybrid_search(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_embedding: list[float],
        query_text: str,
        top_n: int = 20,
        strategy: str = "auto",
        vector_weight: float = 0.6,
        text_weight: float = 0.4,
        source_ids: list[ObjectId] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Hybrid search combining dense ANN + BM25.

        strategy:
          "rankfusion"  -- single $rankFusion stage (Atlas 7.3+ / M10+)
          "manual"      -- parallel queries + Reciprocal Rank Fusion (Python, k=60)
          "auto"        -- probe $rankFusion once; fall back to "manual" if unsupported
        """
        global _rankfusion_supported

        effective_strategy = strategy

        if strategy == "auto":
            if _rankfusion_supported is None:
                await _probe_rankfusion(self._collection, workspace_id, kb_id)
            effective_strategy = "rankfusion" if _rankfusion_supported else "manual"

        elif strategy == "rankfusion" and _rankfusion_supported is False:
            # Caller explicitly asked for rankfusion but we know it's not supported
            logger.warning("$rankFusion not supported on this cluster; falling back to manual RRF")
            effective_strategy = "manual"

        if effective_strategy == "rankfusion":
            return await self._hybrid_rankfusion(
                workspace_id, kb_id, query_embedding, query_text, top_n, source_ids
            )
        else:
            return await self._hybrid_manual_rrf(
                workspace_id, kb_id, query_embedding, query_text, top_n,
                vector_weight, text_weight, source_ids
            )

    async def _hybrid_rankfusion(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_embedding: list[float],
        query_text: str,
        top_n: int,
        source_ids: list[ObjectId] | None,
    ) -> list[dict[str, Any]]:
        """
        $rankFusion pipeline -- Atlas native hybrid search.
        Available on Atlas 7.3+ dedicated clusters.
        """
        text_filter = self._text_filter(workspace_id, kb_id, source_ids)
        pipeline = [
            {
                "$rankFusion": {
                    "input": {
                        "pipelines": {
                            "vectorPipeline": [
                                {
                                    "$vectorSearch": {
                                        "index": self.VECTOR_INDEX,
                                        "path": "embedding",
                                        "queryVector": query_embedding,
                                        "numCandidates": min(top_n * 10, 500),
                                        "limit": top_n * 2,
                                        "filter": self._vector_filter(
                                            workspace_id, kb_id, source_ids
                                        ),
                                    }
                                }
                            ],
                            "textPipeline": [
                                {
                                    "$search": {
                                        "index": self.TEXT_INDEX,
                                        "compound": {
                                            "must": [
                                                {
                                                    "text": {
                                                        "query": query_text,
                                                        "path": ["text", "metadata.title"],
                                                        "fuzzy": {"maxEdits": 1},
                                                    }
                                                }
                                            ],
                                            "filter": text_filter["compound"]["filter"],
                                        },
                                        "scoreDetails": True,
                                    }
                                },
                                {"$limit": top_n * 2},
                            ],
                        }
                    },
                    "combination": {
                        "weights": {"vectorPipeline": 0.6, "textPipeline": 0.4}
                    },
                }
            },
            {"$limit": top_n},
            {
                "$addFields": {
                    "fusedScore": {"$meta": "rankFusionScore"},
                    "vectorScore": 0.0,  # Atlas doesn't expose per-pipeline scores here
                    "textScore": 0.0,
                    "vectorRank": None,
                    "textRank": None,
                }
            },
            {"$project": {"embedding": 0}},
        ]
        docs = await (await self._collection.aggregate(pipeline)).to_list(length=top_n)
        for doc in docs:
            _stringify_ids(doc)
        return docs

    async def _hybrid_manual_rrf(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None,
        query_embedding: list[float],
        query_text: str,
        top_n: int,
        vector_weight: float,
        text_weight: float,
        source_ids: list[ObjectId] | None,
    ) -> list[dict[str, Any]]:
        """
        Manual Reciprocal Rank Fusion (RRF) hybrid search.

        RRF formula: score(d) = sum_i  weight_i / (rank_i + k)
        k=60 is the standard constant that reduces the impact of high ranks.

        Both queries run in parallel. Results are merged and re-ranked in Python.
        """
        # Run both searches concurrently -- do NOT build $vectorSearch or $search
        # stages anywhere outside this module.
        fetch_n = min(top_n * 3, 60)  # Over-fetch so RRF has enough candidates
        vector_results, text_results = await asyncio.gather(
            self.vector_search(workspace_id, kb_id, query_embedding, fetch_n, source_ids),
            self.text_search(workspace_id, kb_id, query_text, fetch_n, source_ids),
        )

        # Build lookup maps: str(_id) -> doc
        merged: dict[str, dict[str, Any]] = {}

        for rank, doc in enumerate(vector_results, start=1):
            _id = str(doc["_id"])
            if _id not in merged:
                merged[_id] = dict(doc)
            merged[_id]["vectorRank"] = rank
            merged[_id]["vectorScore"] = doc.get("vectorScore", 0.0)

        for rank, doc in enumerate(text_results, start=1):
            _id = str(doc["_id"])
            if _id not in merged:
                merged[_id] = dict(doc)
            merged[_id]["textRank"] = rank
            merged[_id]["textScore"] = doc.get("textScore", 0.0)

        # Compute RRF score for each merged doc
        K = 60  # Standard RRF constant
        for doc in merged.values():
            v_rank = doc.get("vectorRank")
            t_rank = doc.get("textRank")
            v_score = (vector_weight / (v_rank + K)) if v_rank is not None else 0.0
            t_score = (text_weight / (t_rank + K)) if t_rank is not None else 0.0
            doc["fusedScore"] = v_score + t_score
            # Fill defaults for docs that only appeared in one leg
            doc.setdefault("vectorRank", None)
            doc.setdefault("textRank", None)
            doc.setdefault("vectorScore", 0.0)
            doc.setdefault("textScore", 0.0)

        # Sort descending by fusedScore, return top_n
        ranked = sorted(merged.values(), key=lambda d: d["fusedScore"], reverse=True)
        return ranked[:top_n]

    # ------------------------------------------------------------------
    # Mutation helpers
    # ------------------------------------------------------------------

    async def delete_by_source(
        self,
        workspace_id: ObjectId,
        source_id: ObjectId,
    ) -> int:
        result = await self._collection.delete_many(
            {"workspaceId": workspace_id, "sourceId": source_id}
        )
        return result.deleted_count

    async def delete_by_knowledge_base(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId,
    ) -> int:
        result = await self._collection.delete_many(
            {"workspaceId": workspace_id, "knowledgeBaseId": kb_id}
        )
        return result.deleted_count

    async def count(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId | None = None,
    ) -> int:
        query: dict[str, Any] = {"workspaceId": workspace_id}
        if kb_id is not None:
            query["knowledgeBaseId"] = kb_id
        return await self._collection.count_documents(query)


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_store_instance: AtlasVectorStore | None = None


def get_vector_store(
    client: AsyncMongoClient | None = None,
    db_name: str | None = None,
) -> AtlasVectorStore:
    """Return (or create) the singleton AtlasVectorStore."""
    global _store_instance
    if _store_instance is None:
        if client is None or db_name is None:
            raise RuntimeError(
                "get_vector_store() called before initialisation. "
                "Pass client and db_name on the first call."
            )
        _store_instance = AtlasVectorStore(client=client, db_name=db_name)
    return _store_instance


def reset_vector_store() -> None:
    """Reset the singleton -- for tests only."""
    global _store_instance, _rankfusion_supported
    _store_instance = None
    _rankfusion_supported = None


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _stringify_ids(doc: dict[str, Any]) -> None:
    """Convert ObjectId fields to str in-place for JSON-safe transport."""
    for key in ("_id", "workspaceId", "knowledgeBaseId", "sourceId"):
        if key in doc and isinstance(doc[key], ObjectId):
            doc[key] = str(doc[key])


async def _probe_rankfusion(
    collection,
    workspace_id: ObjectId,
    kb_id: ObjectId | None,
) -> None:
    """
    Probe whether $rankFusion is supported on this Atlas cluster.
    Result is cached in the module-level `_rankfusion_supported` flag.
    This function is safe to call concurrently -- the asyncio.Lock prevents
    duplicate probes.
    """
    global _rankfusion_supported
    async with _rankfusion_lock:
        if _rankfusion_supported is not None:
            return  # Another coroutine already probed

        # Minimal probe pipeline -- zero-vector, limit 1
        dummy_embedding = [0.0] * get_settings().EMBEDDING_DIMENSIONS
        probe_pipeline = [
            {
                "$rankFusion": {
                    "input": {
                        "pipelines": {
                            "v": [
                                {
                                    "$vectorSearch": {
                                        "index": AtlasVectorStore.VECTOR_INDEX,
                                        "path": "embedding",
                                        "queryVector": dummy_embedding,
                                        "numCandidates": 1,
                                        "limit": 1,
                                        "filter": {"workspaceId": {"$eq": workspace_id}},
                                    }
                                }
                            ],
                            "t": [
                                {
                                    "$search": {
                                        "index": AtlasVectorStore.TEXT_INDEX,
                                        "text": {"query": "__probe__", "path": "text"},
                                    }
                                },
                                {"$limit": 1},
                            ],
                        }
                    }
                }
            },
            {"$limit": 1},
        ]
        try:
            await (await collection.aggregate(probe_pipeline)).to_list(length=1)
            _rankfusion_supported = True
            logger.info("$rankFusion supported on this Atlas cluster -- using native hybrid search")
        except Exception as exc:
            _rankfusion_supported = False
            logger.warning(
                "$rankFusion not supported (or errored) on this cluster; "
                "falling back to manual RRF for all hybrid searches. "
                f"Probe error: {exc}"
            )

