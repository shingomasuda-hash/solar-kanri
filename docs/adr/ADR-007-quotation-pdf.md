# ADR-007: Quotation document generation

**Status:** Accepted · 2026-08-26

## Context

A quotation must be printable and shareable as a PDF, in Japanese, with a
layout a customer will read next to a competitor's.

## Decision

A dedicated **print-optimised HTML route** (`/projects/[id]/quotations/[qid]/print`)
with a `@media print` stylesheet. The operator prints it, and every browser's
print dialog offers "Save as PDF".

## Rationale

The deciding factor is CJK typography.

A server-side PDF library (`@react-pdf/renderer`, `pdfkit`) draws text with
fonts it embeds. Neither bundles a CJK face, so Japanese text renders as blank
boxes unless we ship one. That means:

- a ~5 MB font binary committed to the repository,
- a font licence to comply with and to re-check on every update,
- one hard-coded typeface, regardless of house style,
- and a second, subtly different rendering path from what the operator sees on
  screen.

Printing from the browser has none of those problems. It uses the viewer's
system fonts, so Japanese renders correctly everywhere with no bundled asset;
the print preview is the document; and the operator gets paper size, margins and
orientation from a dialog they already know.

This is also common practice for Japanese B2B quotation tools, so it is not a
surprising workflow for the people using it.

### What we give up

Unattended generation. There is no way to produce a PDF without a human
pressing print, so an automated "email the quotation nightly" feature is not
possible as built.

If that becomes a requirement, the path is headless Chromium
(`page.pdf()`) rendering the same print route — which reuses this layout
exactly, rather than maintaining a second one. Deferred until something
actually needs it (brief rule 43: complexity only when measurement demands it).

## Implementation notes

- The print route renders from the quotation's **stored figures**, never by
  recomputing. An issued quotation carries a frozen `simulationSnapshot`, so a
  later re-simulation or coefficient edit cannot change a document a customer
  already holds.
- Engine versions are printed in the footer, so any figure on the page can be
  traced back to the exact model that produced it.
- Navigation, buttons and the app shell are `display: none` in print.
- Page breaks are set so a line-item table never splits a row across pages.

## Consequences

- No PDF dependency, no bundled font, no licence surface.
- The printed document and the on-screen document are the same code.
- Automated delivery needs the headless-Chromium step above first.
