# UI Density Audit — 23 November 2026

**Status:** Open — implementation in progress  
**Scope:** Shared typography, padding, and spacing across Checklist, Diary, Garden, sign-in, and Settings.

## Problem

App typography and internal spacing feel oversized and consume more screen space than the content needs. Cards, sections, forms, and headings should feel balanced, compact, and easy to scan without becoming cramped.

## Reference

Use Facebook Messenger only as a high-level reference for compact readability and information density: restrained type sizing, clear hierarchy, comfortable line height, and efficient spacing. Do not reproduce Messenger branding, icons, colors, distinctive components, or exact layouts.

Basic measurements such as font sizes, line heights, and spacing values are functional design choices; the implementation must remain an original Faith & Focus interface.

## Guardrails

- Keep all work isolated from `main`.
- Prefer shared, reversible CSS changes over broad HTML or JavaScript rewrites.
- Avoid blanket selectors that indiscriminately shrink every element.
- Preserve minimum interactive touch targets and readable form-entry text.
- Do not introduce fixed heights or widths that clip content.
- Preserve the watercolor identity and the current mobile layout.
- Keep behavior, storage, authentication, and synchronization untouched.

## Acceptance criteria

- Reduce oversized headings and body text into a consistent, deliberate type hierarchy.
- Reduce excessive page, card, form, and section padding.
- Use available viewport space more efficiently on mobile and desktop.
- Retain comfortable line height, readable controls, focus indicators, and touch targets.
- No clipping, overlap, overflow, hidden controls, or broken navigation.
- All existing regression, security, stylesheet, Worker, and browser tests pass.

## Validation

Review at narrow phone, standard phone, tablet, and desktop widths. Compare the affected scenes before and after, then run the complete repository test workflow.
