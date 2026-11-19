"""
app/api/evaluate.py
===================
POST /evaluate endpoint for RAG retrieval & generation benchmarking (Stage 5).
Computes:
  - Hit Rate @ K
  - Mean Reciprocal Rank (MRR)
  - LLM / grounded Faithfulness score
  - Answer Relevance score
Persists comprehensive JSON run reports to evals/reports/.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import logger
from app.core.tenant import require_workspace_id, verify_internal_key
from app.rag.retriever import Retriever
from app.rag.vector_store import get_vector_store
from app.schemas.retrieval import RankedChunk

router = APIRouter(tags=["Evaluation"])

EVALS_DIR = Path(__file__).resolve().parents[2] / "evals"
DATASETS_DIR = EVALS_DIR / "datasets"
REPORTS_DIR = EVALS_DIR / "reports"


class EvalQueryItem(BaseModel):
    id: str
    question: str
    ground_truth_answer: str = ""
    expected_keywords: List[str] = Field(default_factory=list)
    expected_title: Optional[str] = None


class EvaluateRequest(BaseModel):
    knowledgeBaseId: str = Field(..., description="Knowledge base 24-hex ObjectId")
    dataset_name: Optional[str] = Field(default="qa-pairs.json", description="Filename in evals/datasets/")
    queries: Optional[List[EvalQueryItem]] = Field(default=None, description="Inline query pairs if not reading from file")
    top_k: int = Field(default=5, ge=1, le=20)
    strategy: str = Field(default="auto")


class EvalQueryResult(BaseModel):
    id: str
    question: str
    hit: bool
    first_hit_rank: Optional[int] = None
    reciprocal_rank: float = 0.0
    faithfulness_score: float = 0.0
    relevance_score: float = 0.0
    retrieved_chunk_ids: List[str] = Field(default_factory=list)


class EvaluateResponse(BaseModel):
    timestamp: str
    dataset: str
    knowledgeBaseId: str
    total_queries: int
    hit_rate_at_k: float
    mrr: float
    avg_faithfulness: float
    avg_relevance: float
    report_file: str
    results: List[EvalQueryResult]


def _is_chunk_relevant(chunk: RankedChunk, expected_keywords: List[str], expected_title: Optional[str]) -> bool:
    """Evaluates if a chunk is relevant to the query criteria."""
    text_lower = chunk.text.lower()
    title_lower = ((chunk.metadata or {}).get("title") or "").lower()

    if expected_title and expected_title.lower() in title_lower:
        return True

    if expected_keywords:
        matched = sum(1 for kw in expected_keywords if kw.lower() in text_lower or kw.lower() in title_lower)
        # If at least half the keywords are found, consider it a hit
        threshold = max(1, len(expected_keywords) // 2)
        if matched >= threshold:
            return True

    return False


def _extract_clean_words(text: str) -> set[str]:
    """Extract clean lowercase words > 2 chars, stripping punctuation."""
    words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
    # filter common stopwords
    stopwords = {"does", "what", "from", "with", "this", "that", "have", "were", "they", "will"}
    return set(w for w in words if w not in stopwords)


def _compute_relevance_score(question: str, retrieved_chunks: List[RankedChunk]) -> float:
    """Heuristic word-overlap relevance metric between query terms and top chunks."""
    if not retrieved_chunks:
        return 0.0
    q_words = _extract_clean_words(question)
    if not q_words:
        return 1.0
    combined_text = " ".join(c.text.lower() for c in retrieved_chunks)
    found = sum(1 for w in q_words if w in combined_text)
    return round(min(1.0, found / len(q_words)), 3)


def _compute_faithfulness_score(ground_truth: str, retrieved_chunks: List[RankedChunk]) -> float:
    """Grounded overlap metric between ground-truth reference text and retrieved context."""
    if not ground_truth or not retrieved_chunks:
        return 0.5
    gt_words = _extract_clean_words(ground_truth)
    if not gt_words:
        return 1.0
    combined_text = " ".join(c.text.lower() for c in retrieved_chunks)
    found = sum(1 for w in gt_words if w in combined_text)
    return round(min(1.0, found / len(gt_words)), 3)


def _get_retriever(
    request: Request,
    _key: str = Depends(verify_internal_key),
    _ws: ObjectId = Depends(require_workspace_id),
) -> Retriever:
    settings = get_settings()
    client = getattr(request.app.state, "mongo_client", None)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SERVICE_UNAVAILABLE", "message": "Database client not ready"},
        )
    store = get_vector_store(client=client, db_name=settings.MONGODB_DB_NAME)
    return Retriever(vector_store=store)


@router.post(
    "/evaluate",
    response_model=EvaluateResponse,
    summary="Benchmark RAG retrieval and generation performance",
    description=(
        "Executes a standardized evaluation dataset against the knowledge base, "
        "calculating Hit Rate@k, MRR, Faithfulness, and Relevance metrics. "
        "Saves the report to evals/reports/."
    ),
)
async def evaluate_knowledge_base(
    body: EvaluateRequest,
    _key: str = Depends(verify_internal_key),
    ws_id: ObjectId = Depends(require_workspace_id),
    retriever: Retriever = Depends(_get_retriever),
) -> EvaluateResponse:
    workspace_id = ws_id
    if not ObjectId.is_valid(body.knowledgeBaseId):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_KB_ID", "message": "knowledgeBaseId must be a 24-hex ObjectId"},
        )
    kb_id = ObjectId(body.knowledgeBaseId)

    # 1. Load dataset
    query_items: List[EvalQueryItem] = []
    dataset_name = body.dataset_name or "inline"
    if body.queries:
        query_items = body.queries
    else:
        dataset_path = DATASETS_DIR / dataset_name
        if not dataset_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "DATASET_NOT_FOUND", "message": f"Dataset file {dataset_name} not found in evals/datasets/"},
            )
        try:
            with open(dataset_path, "r", encoding="utf-8") as f:
                raw_data = json.load(f)
                query_items = [EvalQueryItem(**item) for item in raw_data]
        except Exception as exc:
            logger.error(f"Failed to read evaluation dataset: {exc}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "DATASET_PARSE_ERROR", "message": f"Could not parse dataset: {exc}"},
            )

    if not query_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "EMPTY_DATASET", "message": "No query items to evaluate"},
        )

    # 2. Run retrieval for each query item
    eval_results: List[EvalQueryResult] = []
    total_hits = 0
    sum_rr = 0.0
    sum_faithfulness = 0.0
    sum_relevance = 0.0

    for item in query_items:
        try:
            res = await retriever.retrieve(
                workspace_id=workspace_id,
                kb_id=kb_id,
                query=item.question,
                top_n=body.top_k * 2,
                top_k=body.top_k,
                strategy=body.strategy,
            )
            chunks = res.results
        except Exception as exc:
            logger.warning(f"Evaluation query {item.id} failed: {exc}")
            chunks = []

        # Find first rank of relevant chunk
        first_hit_rank: Optional[int] = None
        hit = False
        for rank, chunk in enumerate(chunks, start=1):
            if _is_chunk_relevant(chunk, item.expected_keywords, item.expected_title):
                first_hit_rank = rank
                hit = True
                break

        rr = (1.0 / first_hit_rank) if first_hit_rank else 0.0
        if hit:
            total_hits += 1
        sum_rr += rr

        faithfulness = _compute_faithfulness_score(item.ground_truth_answer, chunks)
        relevance = _compute_relevance_score(item.question, chunks)

        sum_faithfulness += faithfulness
        sum_relevance += relevance

        eval_results.append(
            EvalQueryResult(
                id=item.id,
                question=item.question,
                hit=hit,
                first_hit_rank=first_hit_rank,
                reciprocal_rank=round(rr, 3),
                faithfulness_score=faithfulness,
                relevance_score=relevance,
                retrieved_chunk_ids=[c.chunkId for c in chunks],
            )
        )

    num_q = len(query_items)
    hit_rate = round(total_hits / num_q, 3)
    mrr = round(sum_rr / num_q, 3)
    avg_faithfulness = round(sum_faithfulness / num_q, 3)
    avg_relevance = round(sum_relevance / num_q, 3)

    # 3. Persist evaluation report
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    now_iso = datetime.now(timezone.utc).isoformat()
    report_filename = f"eval_{int(datetime.now(timezone.utc).timestamp())}.json"
    report_path = REPORTS_DIR / report_filename

    response_data = EvaluateResponse(
        timestamp=now_iso,
        dataset=dataset_name,
        knowledgeBaseId=str(kb_id),
        total_queries=num_q,
        hit_rate_at_k=hit_rate,
        mrr=mrr,
        avg_faithfulness=avg_faithfulness,
        avg_relevance=avg_relevance,
        report_file=str(report_path),
        results=eval_results,
    )

    try:
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(response_data.model_dump(), f, indent=2)
        logger.info(f"Evaluation report written to {report_path}")
    except Exception as exc:
        logger.error(f"Failed to write evaluation report file: {exc}")

    return response_data
