"""Source deduplication, classification, and credibility scoring."""

from urllib.parse import urlparse
from typing import Optional


# Domain → credibility tier mapping
_DOMAIN_TIERS: dict[str, str] = {
    # Government / international orgs
    ".gov": "high", ".mil": "high", ".edu": "high",
    "un.org": "high", "who.int": "high", "europa.eu": "high",
    "whitehouse.gov": "high", "congress.gov": "high",
    "ec.europa.eu": "high", "gov.uk": "high",
    # Major media / research / law firms
    "reuters.com": "medium-high", "apnews.com": "medium-high",
    "bbc.com": "medium-high", "bbc.co.uk": "medium-high",
    "nytimes.com": "medium-high", "wsj.com": "medium-high",
    "ft.com": "medium-high", "economist.com": "medium-high",
    "nature.com": "medium-high", "science.org": "medium-high",
    "arxiv.org": "medium-high",
    "wsgr.com": "medium-high", "cooley.com": "medium-high",
    "mckinsey.com": "medium-high", "gartner.com": "medium-high",
    # Tech blogs / company blogs
    "blog.google": "medium", "openai.com": "medium",
    "microsoft.com": "medium", "aws.amazon.com": "medium",
    "medium.com": "medium", "dev.to": "medium",
    "huggingface.co": "medium", "github.com": "medium",
    # Forums / community
    "reddit.com": "low", "news.ycombinator.com": "low",
    "quora.com": "low", "stackoverflow.com": "low",
    # Aggregators / unknown
    "aggregator": "excluded",
}


def _get_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().lstrip("www.")
    except Exception:
        return ""


def classify_source(url: str, title: str = "") -> str:
    """Classify a URL into a source category.

    Returns: 'government', 'academic', 'media', 'research', 'tech_blog',
             'forum', 'aggregator', 'unknown'
    """
    domain = _get_domain(url)
    if not domain:
        return "unknown"

    if domain.endswith(".gov") or domain.endswith(".mil") or domain.endswith(".edu"):
        return "government" if (domain.endswith(".gov") or domain.endswith(".mil")) else "academic"
    if any(d in domain for d in ["un.org", "who.int", "europa.eu", "oecd.org", "worldbank.org"]):
        return "government"
    if any(d in domain for d in ["arxiv.org", "nature.com", "science.org", "ieee.org", "acm.org"]):
        return "academic"
    if any(d in domain for d in ["reuters.com", "apnews.com", "bbc.", "nytimes.com", "wsj.com", "ft.com", "economist.com"]):
        return "media"
    if any(d in domain for d in ["mckinsey.com", "gartner.com", "forrester.com", "deloitte.com", "wsgr.com"]):
        return "research"
    if any(d in domain for d in ["reddit.com", "news.ycombinator.com", "quora.com", "stackoverflow.com"]):
        return "forum"
    if any(d in domain for d in ["medium.com", "dev.to", "blog.", "huggingface.co"]):
        return "tech_blog"
    return "unknown"


def score_credibility(url: str, title: str = "") -> dict:
    """Score source credibility.

    Returns: { 'score': float 0-1, 'tier': str, 'reason': str }
    """
    domain = _get_domain(url)
    if not domain:
        return {"score": 0.0, "tier": "unknown", "reason": "无法解析域名"}

    # Check exact domain matches first
    for pattern, tier in _DOMAIN_TIERS.items():
        if pattern.startswith(".") and domain.endswith(pattern):
            tier_scores = {"high": 0.95, "medium-high": 0.8, "medium": 0.6, "low": 0.3, "excluded": 0.0}
            return {"score": tier_scores.get(tier, 0.5), "tier": tier, "reason": f"域名后缀 {pattern}"}
        if pattern in domain:
            tier_scores = {"high": 0.95, "medium-high": 0.8, "medium": 0.6, "low": 0.3, "excluded": 0.0}
            return {"score": tier_scores.get(tier, 0.5), "tier": tier, "reason": f"域名匹配 {pattern}"}

    # Fallback: classify by category
    category = classify_source(url, title)
    category_scores = {
        "government": 0.95, "academic": 0.9, "media": 0.8, "research": 0.8,
        "tech_blog": 0.6, "forum": 0.3, "aggregator": 0.0, "unknown": 0.5,
    }
    return {"score": category_scores.get(category, 0.5), "tier": category, "reason": f"分类: {category}"}


def deduplicate_sources(sources: list[dict]) -> list[dict]:
    """Remove duplicate sources by URL, keeping the first occurrence.

    Each source dict must have a 'url' key.
    """
    seen_urls: set[str] = set()
    deduped = []
    for src in sources:
        url = src.get("url", "")
        normalized = url.rstrip("/").lower()
        if normalized and normalized not in seen_urls:
            seen_urls.add(normalized)
            deduped.append(src)
    return deduped


def rank_sources(sources: list[dict], max_sources: int = 10) -> list[dict]:
    """Deduplicate, classify, score, and rank sources.

    Each source dict should have 'url' and optionally 'title'.
    Returns sources enriched with 'credibility', 'category', sorted by score descending.
    """
    deduped = deduplicate_sources(sources)
    enriched = []
    for src in deduped:
        url = src.get("url", "")
        title = src.get("title", "")
        cred = score_credibility(url, title)
        category = classify_source(url, title)
        enriched.append({
            **src,
            "category": category,
            "credibility_score": cred["score"],
            "credibility_tier": cred["tier"],
            "credibility_reason": cred["reason"],
        })

    # Sort by credibility descending
    enriched.sort(key=lambda x: x.get("credibility_score", 0), reverse=True)
    return enriched[:max_sources]


def filter_core_findings(sources: list[dict]) -> list[dict]:
    """Filter sources eligible for core findings (exclude forums and aggregators)."""
    return [s for s in sources if s.get("credibility_score", 0) >= 0.5]
