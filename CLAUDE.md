# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
```bash
npm run install:web      # Install web dependencies
npm run install:mobile   # Install mobile dependencies
```

### Development
```bash
npm run dev:web          # Start Vite dev server at http://localhost:6173
npm run dev:mobile       # Start Expo dev server (then press i/a for iOS/Android)
```

### Web build & type-check
```bash
cd web && npm run build     # tsc --noEmit + vite build → dist/
cd web && npx tsc --noEmit  # Type-check only
```

### Mobile targets
```bash
cd mobile && npm run ios      # Run on iOS simulator
cd mobile && npm run android  # Run on Android emulator
```

There are no test scripts in this repo.

## Architecture

GoPickle is a **TypeScript frontend monorepo** with three packages:

```
web/      — React + Vite SPA (desktop + mobile web)
mobile/   — Expo React Native app (iOS + Android)
shared/   — Shared TypeScript type definitions
```

### Shared types (`shared/src/index.ts`)
Both `web` and `mobile` import domain types from here: `GameType` ("REC" | "DUPR"), `GameFormat` ("SINGLES" | "DOUBLES" | "MIXED"), `ContactIdentity`, `BuddyInvite`. Core entities — User, Club, Game, Tournament, Buddy — are defined as TypeScript interfaces here.

### API client pattern
Both apps use a thin REST client that points at an external backend (`http://localhost:4000` by default). Environment variables control the base URL:
- Web: `VITE_API_BASE` (see `web/.env.example`)
- Mobile: `EXPO_PUBLIC_API_BASE` (see `mobile/.env.example`)

Key API routes the clients call: `/auth/login`, `/buddies/{userId}`, `/clubs`, `/games`, `/tournaments`.

### Web (`web/src/`)
- `App.tsx` — root component; renders all views
- `lib/api.ts` — all REST calls; every function returns typed responses using the shared types

### Mobile (`mobile/src/`)
- `App.tsx` — root component, mirrors web structure using React Native primitives
- `index.js` — Expo entry point that registers `App`
