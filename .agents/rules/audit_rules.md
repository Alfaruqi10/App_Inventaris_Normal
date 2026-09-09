# Rules for Audit Operations

Whenever an audit operation (e.g. audit pipeline, audit API, audit mapping, audit date range, or audit metrics) is requested or completed:

1. **Automatic Markdown Generation**: Always generate a dedicated, structured Markdown file artifact in the artifacts directory (`<appDataDir>\brain\<conversation-id>\AUDIT_<NAME>.md`).
2. **Comprehensive Format**: The Markdown file must include:
   - Untruncated Raw API responses (JSON).
   - Traceability & mapping logic (line-by-line function references).
   - 1-to-1 Cross-validation table comparing Seller Center UI vs Raw API vs Database vs Dashboard.
   - Empirical status verification (100% Identik / 0 Selisih).
3. **No Delay**: Generate the Markdown file immediately upon completing the audit steps.
