# AgentMemory — Frontend

React + TypeScript + Vite research workspace for **AgentMemory**.

## Tech Stack
- React 19, TypeScript 6, Vite 8
- Tailwind CSS v4 (design tokens in `src/styles/tokens.css`)
- React Router v7, TanStack Query v5, Zustand v5
- React Hook Form + Zod, Lucide React, Recharts, Vitest

## Development
Start PostgreSQL and the FastAPI backend (`:8000`) first, then run:

```bash
npm install
npm run dev
```

Vite proxies `/api` and `/health` requests to `http://127.0.0.1:8000`.

## Quality Checks
```bash
npm run build
npm run lint
npm test
```