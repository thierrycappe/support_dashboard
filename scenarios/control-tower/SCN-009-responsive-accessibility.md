---
id: SCN-009
title: Verify responsive and accessible operator navigation
area: control-tower
status: active
last_synced: 2026-08-13
linked_spec: e2e/scenarios/control-tower/SCN-009.spec.ts
spec_hash: 3c810f2e
---

# SCN-009 — Verify responsive and accessible operator navigation

## Actors

- Keyboard-only support operator

## Happy path

1. Tab exposes the skip link and Enter moves focus to main content.
2. Dark preference preserves readable application content.
3. Reduced-motion preference is honored without removing state labels.
4. Desktop, tablet, 390px, and 320px layouts keep navigation and primary action usable without page overflow.

## Projects

- The journey runs in Desktop Chromium, Pixel 5 Chromium, and iPhone 13 WebKit profiles.
