# UI Density Audit — 23 November 2026

**Status:** Open — width refinement in progress  
**Scope:** Shared typography, padding, and spacing across Checklist, Diary, Garden, sign-in, and Settings.

## Problem

App typography and internal spacing feel oversized and consume more screen space than the content needs. Cards, sections, forms, and headings should feel balanced, compact, and easy to scan without becoming cramped.

A follow-up visual review on 23 November 2026 identified a separate width problem: outer frames and row-level backgrounds stretch across most of the available viewport even when their labels and actions occupy a much smaller portion. Padding reduction alone does not solve this. Main content needs a deliberate centered reading column, short action rows should size to their contents, and nested Diary panels should be narrower than their parent while text-entry fields retain practical writing width.

The next review found that the previous width acceptance bound was too permissive: a frame occupying 86% of the viewport could still pass a 91% maximum. Replace percentage-only assumptions with measured geometry at each viewport. Use 8px vertical / 10px horizontal frame padding, 6px / 8px action-row padding, 4px / 8px button padding, and non-growing content-width buttons. Maintain 44px minimum control height at phone widths; desktop controls may use a 36px minimum.

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
- Constrain the shared content column using a continuous viewport-width formula, with phone gutters and compact tablet/desktop proportions.
- Limit frame padding to 8px vertically and 10px horizontally.
- Limit short action-row padding to 6px vertically and 8px horizontally.
- Limit button padding to 4px vertically and 8px horizontally; prevent non-primary buttons from growing to fill their containers.
- Keep phone controls at least 44px high and desktop controls at least 36px high.
- Let short checklist/action row frames follow their labels and controls instead of stretching to the full card width.
- Keep nested Diary panels visually narrower than the outer Diary frame without clipping note fields or saved records.
- Retain comfortable line height, readable controls, focus indicators, and touch targets.
- No clipping, overlap, overflow, hidden controls, or broken navigation.
- All existing regression, security, stylesheet, Worker, and browser tests pass.

## Validation

Review at narrow phone, standard phone, tablet, and desktop widths. Compare the affected scenes before and after, then run the complete repository test workflow.
