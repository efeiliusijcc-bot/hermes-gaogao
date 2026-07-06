---
name: controlled-web-collector
description: Controlled public web collection through the Hermes NestJS backend crawler APIs. Use only during report-agent Research Phase when context.json.crawlerPlan.enabled is true.
---

# Controlled Web Collector

This skill never executes Python, shell commands, browser automation, login flows, captcha bypasses, or arbitrary user code.

It calls the NestJS backend internal crawler API only:

- `crawler.create_task` -> `POST /api/internal/crawler/tasks`
- `crawler.run_task` -> `POST /api/internal/crawler/tasks/:taskId/run`
- `crawler.get_items` -> `GET /api/internal/crawler/tasks/:taskId/items`

All calls must include:

```http
x-internal-skill-token: ${INTERNAL_SKILL_TOKEN}
```

## Required Inputs

`crawler.create_task` requires:

- `jobId`
- `ownerId`
- `ownerUsername`
- `title`
- `goal`
- `crawlerPlan`

## Safety Rules

The backend enforces these rules, and the agent must not try to bypass them:

- Only `http` and `https` URLs are allowed.
- No localhost, loopback, private network, `file://`, `ftp://`, `javascript:`, or `data:` URLs.
- No user cookies.
- No form submission.
- No login, captcha bypass, or paywall bypass.
- `maxPages` maximum is 50.
- `maxDepth` maximum is 2.
- Timeout is 15 seconds per page.

## Output Contract

After `crawler.get_items`, write results into `context.json.crawlerSourceContext`:

```json
{
  "tasks": [],
  "items": [
    {
      "title": "",
      "url": "",
      "publisher": "",
      "publishedAt": null,
      "fetchedAt": "",
      "contentSummary": "",
      "contentText": "",
      "sourceType": "crawler",
      "relevanceScore": 50,
      "credibilityScore": 50
    }
  ]
}
```

Do not overwrite `database_sources`, `report_plan`, `userPreferenceContext`, or `draftAssistantContext`.
