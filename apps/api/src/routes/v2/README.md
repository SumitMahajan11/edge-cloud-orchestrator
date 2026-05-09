# API V2 Migration Plan

This directory contains the routes and handlers for API version 2.

## Goals
- Transition from REST to more optimized GraphQL-like batch endpoints where appropriate.
- Implement stricter validation schemas for all inputs.
- Move to standard HTTP status codes for all domain-specific errors.

## Planned Changes
- `/tasks`: Introduce bulk submission and priority-based filtering by default.
- `/nodes`: Enhanced telemetry data in the heartbeat response.
- `/auth`: Support for OIDC and short-lived session tokens.

## Deprecation Notice
API v1 is now deprecated as of April 2026. 
- Sunset Date: October 2026 (6 months from now)
- All v1 responses will include `Deprecation: true` and `Sunset` headers.
