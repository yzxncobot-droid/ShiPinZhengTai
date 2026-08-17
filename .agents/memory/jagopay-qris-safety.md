---
name: JagoPay QRIS safety
description: JagoPay's documented qris_mutasi response may not echo the generated order ID, so amount-only wallet crediting is unsafe.
---

The documented JagoPay flow exposes `qris_dinamis` and `qris_mutasi`, but the example mutation payload contains amount, status, date, description, and a mutation ID rather than the application's order ID. Automatic crediting must require a stable correlating gateway/order reference; otherwise leave the top-up pending instead of matching by amount alone.

**Why:** Multiple users can pay the same nominal amount, and the project requirement explicitly forbids crediting when the payment cannot be verified to belong to one transaction.

**How to apply:** Re-check the live JagoPay docs or account response before adding any fallback matcher or webhook. Never restore amount-only matching.