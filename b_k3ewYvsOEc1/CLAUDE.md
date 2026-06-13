# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI深度编报 (nexus-report-system) — a Vue 3 SPA for AI-powered report generation. Connects to an "Hermes" backend to generate four types of intelligence/analysis reports: K报, HB报, 人物报, 风险报. Reports are generated via job queue with SSE real-time updates, viewable in-app, exportable to Word/PDF.

## Development Commands

```bash
pnpm dev          # Vite dev server (preferred over npm)
pnpm build        # Production build
pnpm preview      # Preview production build locally
```

No test framework, linter, or formatter is configured.

## Architecture

**Stack:** Vue 3 Composition API (`<script setup>`) + Vite 6 + Tailwind CSS 3 + vanilla JS (no TypeScript despite tsconfig.json existing — that's a leftover from a v0.dev/Next.js scaffold).

**Component hierarchy:**
```
App.vue — orchestrates two views: generator (sidebar + main) and archive (full-screen table)
  ├── NexusHeader.vue    — brand banner, animated canvas wave, system clock
  ├── ControlPanel.vue   — sidebar: backend health status + recent jobs list
  └── DataCanvas.vue     — main area: type selection, input form, plan modal, report viewer, export
```

**State management:** No Vuex/Pinia. A single composable `src/composables/useReportJobs.js` (~1200 lines) holds all application state via `ref()` and `computed()`. Instantiated once in App.vue, passed down via props/events. This composable manages: form fields, generation lifecycle, plan editing, job polling, SSE connections, execution logs, workspace snapshots, and history pagination.

**API layer:** `src/lib/api.js` — thin fetch wrapper. Base URL defaults to `http://localhost:3001/api` in dev, overridden by `VITE_API_BASE` env var in production (`https://api.test-link.xin/gaogao/api`).

**Report generation lifecycle:**
1. User selects type + fills form → `POST /report-plans` (AI generates a plan)
2. User reviews/edits plan in modal → `POST /report-jobs` (submit job)
3. SSE subscription (`EventSource`) + polling (exponential backoff 2s→10s) track job progress
4. On success → `GET /report-jobs/{id}/result` → DOMPurify sanitize → render HTML

**Workspace snapshot:** The composable saves/restores full workspace state when switching between viewing a history report and returning to an in-progress generation.

## Styling

Dual-theme CSS in `src/styles/main.css` (~1350 lines): a dark cyberpunk theme (deep-void/neon-cyan CRT aesthetic) defined first, then overridden by a light "AI Workbench" theme scoped under `.app-shell`. Tailwind config in `tailwind.config.js` defines custom colors (deep-void, neon-cyan, neon-green, cyber-yellow), fonts (Fira Code, Inter), and animations (pulse-glow, scan-line, flicker, data-stream).

## Key Gotchas

- `tsconfig.json` is dead config from a Next.js scaffold — ignore it. All source is plain .js/.vue.
- `public/fonts/` is empty — fonts come from `@fontsource` npm packages, not static files.
- Both `package-lock.json` and `pnpm-lock.yaml` exist. Use pnpm as the primary package manager.
- Local storage key `nexus-report-history-overrides` stores user-renamed report titles.
- The project originated from v0.dev (Vercel AI scaffolding); `.gitignore` still contains v0/Next.js entries.
