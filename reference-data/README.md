# Production Reference Staging

This directory is local reference staging for audits and reconciliation. It is not a Google Sheet, is not copied to `dist`, and is not imported by Apps Script runtime code.

`production-setup-reference.json` preserves parameters extracted from `Manajemen Stok - Setup.pdf`. It is a snapshot/reference dataset, not a canonical Moving provider. A record is `VALID` only when it has an exact MasterBarang identity and complete FAST/MIDDLE/SLOW plus minimum, ideal, and production-minimum values. Incomplete or non-production-ready source rows are retained as `REVIEW_REQUIRED` rather than becoming active rules.

`sales-ranking-reference.json` preserves sales rank and quantity from `Manajemen Stok - Ranking Sort Fast-mid-slow.pdf`. It is a golden output used to validate SalesLedger formula discovery, not a runtime ranking provider. The five identities without an exact unique MasterBarang match remain `UNRESOLVED`. The two documented color aliases preserve the PDF's slash notation while resolving only to the corresponding exact MasterBarang color; they are not fuzzy SKU matching.

`tools/moving-formula-discovery.mjs` is a pure in-memory experiment helper. It accepts a read-only SalesLedger snapshot and scores candidate groupings, windows, measures, status policies, and deterministic multi-SKU allocation against the golden datasets. It is not loaded by production.

`production-configuration-import-reference.json` preserves the 67 exact identities, MinimumStock, and TargetStock extracted from `Manajemen Stok - Produksi.pdf`. Its MovingReference is evidence-only and is never persisted to `ProductionConfiguration`. `MinimumProductionBatch` is resolved only by exact SKU/product/color/size matching against `production-setup-reference.json` during the controlled local importer.

Both files include source hashes and a read-only MasterBarang snapshot reference for auditability. No runtime code imports these artifacts; this phase does not change any production configuration, evaluator, notification, queue, sheet, or deployment.
