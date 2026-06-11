# ADR-003: Use Fastify instead of Express or NestJS
Date: 2026-06-11
Status: Accepted

## Context
The API layer needed a Node.js HTTP framework. Express is the most common choice. NestJS adds opinionated structure. Fastify optimises for throughput and schema-first development.

## Decision
Fastify v4 with TypeBox/Zod schema validation.

## Consequences
+ 2-3x throughput vs Express in benchmarks
+ Schema-first: all routes validated at compile time and runtime
+ Built-in serialisation — faster JSON responses
+ JSON Schema for Swagger generation without extra libs
- Smaller plugin ecosystem than Express
- Decorator pattern (app.decorate) requires TypeScript augmentation
- Less familiar to Express-trained developers
