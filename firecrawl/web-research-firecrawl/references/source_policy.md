# Source Credibility and Classification Policy

This document defines how the triad intelligence pipeline classifies, scores, deduplicates, and ranks web sources. The implementation lives in `scripts/source_ranker.py`.

---

## Credibility tiers

Every source is assigned to one of five tiers based on its domain.

| Tier | Score | Description |
|------|-------|-------------|
| **high** | 0.95 | Government agencies, military, accredited educational institutions, major international organizations |
| **medium-high** | 0.80 | Established media outlets, peer-reviewed academic journals, top research/consulting firms |
| **medium** | 0.60 | Tech blogs, company engineering blogs, developer platforms |
| **low** | 0.30 | Forums, community Q&A sites, social news aggregators |
| **excluded** | 0.00 | Content farms, aggregator sites with no original content |

---

## Domain mapping table

### High credibility (0.95)

| Pattern | Category | Examples |
|---------|----------|----------|
| `.gov` suffix | Government | fda.gov, sec.gov, nasa.gov |
| `.mil` suffix | Military | army.mil, navy.mil |
| `.edu` suffix | Academic | mit.edu, stanford.edu |
| `un.org` | International org | United Nations |
| `who.int` | International org | World Health Organization |
| `europa.eu` | International org | European Union |
| `whitehouse.gov` | Government | US Executive Office |
| `congress.gov` | Government | US Congress |
| `ec.europa.eu` | Government | European Commission |
| `gov.uk` | Government | UK Government |

### Medium-high credibility (0.80)

| Pattern | Category | Examples |
|---------|----------|----------|
| `reuters.com` | Media | Reuters |
| `apnews.com` | Media | Associated Press |
| `bbc.com` / `bbc.co.uk` | Media | BBC |
| `nytimes.com` | Media | New York Times |
| `wsj.com` | Media | Wall Street Journal |
| `ft.com` | Media | Financial Times |
| `economist.com` | Media | The Economist |
| `nature.com` | Academic | Nature |
| `science.org` | Academic | Science |
| `arxiv.org` | Academic | arXiv preprints |
| `wsgr.com` | Research | Wilson Sonsini |
| `cooley.com` | Research | Cooley LLP |
| `mckinsey.com` | Research | McKinsey |
| `gartner.com` | Research | Gartner |

### Medium credibility (0.60)

| Pattern | Category | Examples |
|---------|----------|----------|
| `blog.google` | Tech blog | Google AI Blog |
| `openai.com` | Tech blog | OpenAI |
| `microsoft.com` | Tech blog | Microsoft |
| `aws.amazon.com` | Tech blog | AWS |
| `medium.com` | Tech blog | Medium |
| `dev.to` | Tech blog | Dev.to |
| `huggingface.co` | Tech blog | Hugging Face |
| `github.com` | Tech blog | GitHub |

### Low credibility (0.30)

| Pattern | Category | Examples |
|---------|----------|----------|
| `reddit.com` | Forum | Reddit |
| `news.ycombinator.com` | Forum | Hacker News |
| `quora.com` | Forum | Quora |
| `stackoverflow.com` | Forum | Stack Overflow |

### Excluded (0.00)

| Pattern | Category | Description |
|---------|----------|-------------|
| `aggregator` | Aggregator | Content farms, scrapers, sites with no original content |

---

## Classification rules

The `classify_source()` function assigns each URL to one of these categories:

| Category | Matching logic |
|----------|---------------|
| `government` | Domain ends with `.gov` or `.mil`, or matches known government domains |
| `academic` | Domain ends with `.edu`, or matches known academic domains (arxiv.org, nature.com, etc.) |
| `media` | Domain matches known media outlets |
| `research` | Domain matches known research/consulting firms |
| `tech_blog` | Domain matches tech blogs, company blogs, developer platforms |
| `forum` | Domain matches forums and community sites |
| `aggregator` | Domain matches content farm patterns |
| `unknown` | No match found -- defaults to medium credibility (0.5) |

### Priority order

1. **Suffix check**: `.gov` and `.mil` always classify as government. `.edu` always classifies as academic.
2. **Exact domain check**: Known domains like `reuters.com` or `arxiv.org` are classified directly.
3. **Keyword check**: Partial domain matching for broader categories (e.g., `blog.` for tech blogs).
4. **Fallback**: If no match, return `unknown`.

---

## Scoring

The `score_credibility()` function returns a dict with three fields:

```python
{
    "score": 0.8,           # float 0.0 - 1.0
    "tier": "medium-high",  # tier name
    "reason": "domain match reuters.com"
}
```

### Score lookup process

1. Extract domain from URL (strip `www.` prefix, lowercase).
2. Check `_DOMAIN_TIERS` mapping for suffix patterns (e.g., `.gov`) and exact domains (e.g., `reuters.com`).
3. If a match is found, return the corresponding tier score.
4. If no domain match, fall back to `classify_source()` and use category-based scores:

| Category | Default score |
|----------|--------------|
| government | 0.95 |
| academic | 0.90 |
| media | 0.80 |
| research | 0.80 |
| tech_blog | 0.60 |
| forum | 0.30 |
| aggregator | 0.00 |
| unknown | 0.50 |

---

## Deduplication

The `deduplicate_sources()` function removes duplicate URLs before scoring.

### Process

1. Normalize each URL: lowercase, strip trailing `/`.
2. Track seen URLs in a set.
3. Keep the first occurrence of each unique normalized URL.
4. Preserve original insertion order for remaining sources.

### Example

Input:
```
https://example.com/article
https://example.com/article/
https://Example.com/article
```

Output (after dedup):
```
https://example.com/article
```

Only the first occurrence is kept.

---

## Ranking

The `rank_sources()` function orchestrates the full pipeline:

1. **Deduplicate** -- remove duplicate URLs.
2. **Classify** -- assign category to each source.
3. **Score** -- compute credibility score and tier.
4. **Enrich** -- add `category`, `credibility_score`, `credibility_tier`, `credibility_reason` to each source dict.
5. **Sort** -- order by credibility score descending.
6. **Truncate** -- return top `max_sources` results.

### Eligibility for key findings

The `filter_core_findings()` function filters sources eligible for inclusion in key findings:

- Credibility score >= 0.5 (tiers: high, medium-high, medium, unknown)
- Excludes: low (0.3) and excluded (0.0)

### Verification flagging

Sources with credibility score < 0.6 are flagged in the `verification_needed` output field. This includes:

- Forum posts (low tier, 0.3)
- Unknown sources (unknown tier, 0.5)
- Aggregator content (excluded tier, 0.0)
