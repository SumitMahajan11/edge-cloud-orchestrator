# Web Application Source Structure

This directory contains the source code for the Edge-Cloud Orchestrator web dashboard.

## Key Files
- **main.tsx**: The primary entry point for the application.
- **App.tsx**: Root component containing routing and global providers.
- **index.css**: Global styles including Tailwind CSS imports and custom base styles.

## Directory Structure
- **components/**: Reusable UI components (atomic design).
- **context/**: React context providers for global state management (singular).
- **hooks/**: Custom React hooks.
- **lib/**: Utility libraries, API clients, and shared logic.
- **pages/**: Top-level page components corresponding to routes.
- **types/**: TypeScript type definitions and interfaces.
- **workers/**: Web workers for background processing.

## Tech Stack
- **Framework**: React 18+ with Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Testing**: Vitest for unit/integration tests, Playwright for E2E.
