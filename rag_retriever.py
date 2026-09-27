"""Shared retrieval augmented generation (RAG) retriever for FastNews.

The retriever deliberately has no keyword ranking path.  It builds a small
in-process vector index over the local corpus and retrieves by cosine
similarity.  Production deployments should set ``RAG_EMBEDDING_URL`` (an
OpenAI compatible ``/embeddings`` endpoint) and ``EMBEDDING_MODEL``.  The
deterministic hash embedder is an offline vector provider for local previews
and tests; it keeps the application usable when no embedding service is
configured without reintroducing lexical retrieval.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import urllib.error
import urllib.request
from array import array
from dataclasses import dataclass
from typing import Iterable, Sequence


TOKEN_RE = re.compile(r"[a-z0-9]+(?:[./_-][a-z0-9]+)*|[\u4e00-\u9fff]", re.I)
DEFAULT_DIMENSIONS = 128
DEFAULT_BATCH_SIZE = 64
_INDEX_CACHE: dict[str, "VectorIndex"] = {}
_CACHE_LOCK = threading.RLock()


def _clip_text(value: object, limit: int = 12000) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def document_text(item: dict) -> str:
    """Create the evidence text that is embedded for one local record."""

    parts = (
        _clip_text(item.get("title"), 320),
        _clip_text(item.get("title_zh"), 160),
        _clip_text(item.get("summary"), 700),
        _clip_text(item.get("search_summary"), 1000),
        _clip_text(item.get("author"), 240),
        _clip_text(item.get("category"), 120),
        _clip_text(item.get("venue"), 120),
    )
    return "\n".join(part for part in parts if part)


def _provider() -> str:
    requested = (os.environ.get("RAG_EMBEDDING_PROVIDER") or "auto").strip().lower()
    if requested in {"hash", "local", "offline"}:
        return "hash"
    if requested in {"openai", "remote", "api"}:
        return "openai"
    # Remote embeddings are opt-in. Chat completion credentials alone must not
    # cause a hidden network request while serving a local page.
    url = os.environ.get("RAG_EMBEDDING_URL", "").strip()
    if url:
        return "openai"
    return "hash"


def provider_name() -> str:
    return _provider()


def _embedding_cache_identity() -> str:
    return "|".join(
        (
            provider_name(),
            os.environ.get("RAG_EMBEDDING_URL", "").strip(),
            os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small").strip(),
            os.environ.get("RAG_EMBEDDING_DIMENSIONS", str(DEFAULT_DIMENSIONS)).strip(),
        )
    )


def _hash_tokens(text: str) -> list[str]:
    lowered = text.lower()
    tokens = TOKEN_RE.findall(lowered)
    # Character n-grams retain some phrase semantics for CJK and inflected
    # English words while remaining a vector operation rather than a filter.
    grams: list[str] = []
    for token in tokens:
        grams.append(token)
        if len(token) > 3 and token.isascii():
            grams.extend(token[i : i + 3] for i in range(len(token) - 2))
    return grams


def _hash_embed(text: str, dimensions: int = DEFAULT_DIMENSIONS) -> array:
    values = [0.0] * dimensions
    grams = _hash_tokens(text)
    if not grams:
        return array("f", values)
    for gram in grams:
        digest = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
        slot = int.from_bytes(digest[:4], "big") % dimensions
        sign = -1.0 if digest[4] & 1 else 1.0
        values[slot] += sign
    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return array("f", (value / norm for value in values))


def _embedding_url() -> str:
    explicit = os.environ.get("RAG_EMBEDDING_URL", "").strip()
    if explicit:
        explicit = explicit.rstrip("/")
        return explicit if explicit.endswith("/embeddings") else explicit + "/embeddings"
    base = (os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
    return base + "/embeddings"


def _remote_embeddings(texts: Sequence[str]) -> list[list[float]]:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured for RAG embeddings")
    payload = {
        "model": os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small").strip(),
        "input": list(texts),
    }
    request = urllib.request.Request(
        _embedding_url(),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    timeout = float(os.environ.get("RAG_EMBEDDING_TIMEOUT", "90"))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8") or "{}")
    rows = data.get("data") if isinstance(data, dict) else None
    if not isinstance(rows, list) or len(rows) != len(texts):
        raise RuntimeError("embedding endpoint returned an unexpected response")
    rows = sorted(rows, key=lambda row: int(row.get("index", 0)) if isinstance(row, dict) else 0)
    vectors = [row.get("embedding") for row in rows if isinstance(row, dict)]
    if len(vectors) != len(texts) or not all(isinstance(row, list) and row for row in vectors):
        raise RuntimeError("embedding endpoint returned invalid vectors")
    return [array("f", (float(value) for value in row)) for row in vectors]


def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    if not texts:
        return []
    if _provider() == "hash":
        return [_hash_embed(text) for text in texts]
    try:
        out: list[list[float]] = []
        batch_size = max(1, int(os.environ.get("RAG_EMBEDDING_BATCH_SIZE", str(DEFAULT_BATCH_SIZE))))
        for start in range(0, len(texts), batch_size):
            out.extend(_remote_embeddings(texts[start : start + batch_size]))
        return out
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, urllib.error.URLError, urllib.error.HTTPError):
        # A failed remote provider still falls back to vector retrieval.  It
        # never falls back to a lexical score or a keyword-only result set.
        return [_hash_embed(text) for text in texts]


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    dot = sum(left[index] * right[index] for index in range(size))
    left_norm = math.sqrt(sum(value * value for value in left[:size]))
    right_norm = math.sqrt(sum(value * value for value in right[:size]))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


@dataclass
class VectorIndex:
    key: str
    items: list[dict]
    vectors: list[list[float]]

    @classmethod
    def build(cls, items: Sequence[dict]) -> "VectorIndex":
        normalized = [item for item in items if isinstance(item, dict)]
        digest = hashlib.sha256(
            (_embedding_cache_identity() + "\n" + "\n".join(
                f"{item.get('id') or item.get('link') or ''}\t{document_text(item)}"
                for item in normalized
            )).encode("utf-8")
        ).hexdigest()
        with _CACHE_LOCK:
            cached = _INDEX_CACHE.get(digest)
            if cached is not None:
                return cached
        vectors = embed_texts([document_text(item) for item in normalized])
        index = cls(digest, normalized, vectors)
        with _CACHE_LOCK:
            _INDEX_CACHE[digest] = index
        return index

    def search(self, query: str, *, limit: int = 16, min_score: float = -1.0) -> list[tuple[float, dict]]:
        query_vector = embed_texts([_clip_text(query, 4000)])[0]
        ranked = [
            (_cosine(query_vector, vector), position, item)
            for position, (vector, item) in enumerate(zip(self.vectors, self.items))
        ]
        ranked = [row for row in ranked if row[0] >= min_score]
        # Keep corpus order as the final tie breaker. It is stable and avoids
        # a hidden title/keyword preference after semantic retrieval.
        ranked.sort(key=lambda row: (-row[0], -(int(row[2].get("year") or 0)), row[1]))
        return [(float(score), item) for score, _, item in ranked[: max(0, int(limit))]]


def clear_cache() -> None:
    with _CACHE_LOCK:
        _INDEX_CACHE.clear()


def retrieve(
    items: Sequence[dict],
    query: str,
    *,
    limit: int = 16,
    min_score: float = -1.0,
    source: str | None = None,
    categories: Iterable[str] = (),
    conferences: Iterable[str] = (),
    years: Iterable[int] = (),
) -> list[tuple[float, dict]]:
    """Filter metadata, then perform vector retrieval over the remaining corpus."""

    source = str(source or "").lower()
    category_set = {str(value) for value in categories if value}
    conference_set = {str(value).lower() for value in conferences if value}
    year_set = {int(value) for value in years if str(value).isdigit()}
    candidates = []
    for item in items:
        if source and source != "all" and str(item.get("source") or "").lower() != source:
            continue
        if category_set and item.get("source") == "top-conf" and item.get("category") not in category_set:
            continue
        if conference_set and str(item.get("conference") or "").lower() not in conference_set:
            continue
        if year_set and item.get("year") not in year_set:
            continue
        candidates.append(item)
    if not candidates or not str(query or "").strip():
        return []
    return VectorIndex.build(candidates).search(query, limit=limit, min_score=min_score)


__all__ = ["VectorIndex", "clear_cache", "document_text", "embed_texts", "provider_name", "retrieve"]
