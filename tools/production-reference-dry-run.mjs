const MOVING_ORDER = { FAST: 0, MIDDLE: 1, SLOW: 2 };
const CANONICAL_SETUP_STATUSES = new Set(["VALID"]);

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function liveConfigurationBySku(rows) {
  const bySku = new Map();
  const duplicates = [];
  (rows || []).forEach((row) => {
    const sku = text(row.SKU);
    if (!sku) return;
    if (bySku.has(sku)) duplicates.push(sku);
    else bySku.set(sku, row);
  });
  return { bySku, duplicates };
}

function canonicalSetupRows(records) {
  return (records || []).filter((row) => CANONICAL_SETUP_STATUSES.has(text(row.ValidationStatus)));
}

function difference(field, current, reference) {
  return { field, current, reference };
}

export function reconcileProductionSetupReference(setupRecords, liveRows) {
  const canonical = canonicalSetupRows(setupRecords);
  const referenceBySku = new Map(canonical.map((row) => [text(row.SKU), row]));
  const live = liveConfigurationBySku(liveRows);
  const matches = [];
  const changesRequired = [];
  const missingInLive = [];

  canonical.forEach((reference) => {
    const sku = text(reference.SKU);
    const current = live.bySku.get(sku);
    if (!current) {
      missingInLive.push({ sku, reference });
      return;
    }

    const differences = [];
    const currentMinimum = number(current.MinimumStock);
    const currentTarget = number(current.TargetStock);
    const currentBatch = number(current.MinimumProductionBatch);
    if (currentMinimum !== number(reference.MinimumStock)) differences.push(difference("MinimumStock", currentMinimum, number(reference.MinimumStock)));
    if (currentTarget !== number(reference.IdealStock)) differences.push(difference("TargetStock", currentTarget, number(reference.IdealStock)));
    if (currentBatch !== number(reference.ProductionMinimum)) differences.push(difference("MinimumProductionBatch", currentBatch, number(reference.ProductionMinimum)));

    // These canonical values are intentionally not persisted in the current live configuration schema.
    differences.push(difference("Moving", "NOT_STORED_IN_LIVE_CONFIGURATION", text(reference.Moving)));
    differences.push(difference("SKUStat", "NOT_STORED_IN_LIVE_CONFIGURATION", text(reference.SKUStat)));
    differences.push(difference("Period", "NOT_STORED_IN_LIVE_CONFIGURATION", text(reference.Period)));

    const result = { sku, current, reference, differences };
    if (differences.length) changesRequired.push(result);
    else matches.push(result);
  });

  const extraInLive = [...live.bySku.entries()]
    .filter(([sku]) => !referenceBySku.has(sku))
    .map(([sku, current]) => ({ sku, current }));

  return {
    totalReferenceRows: (setupRecords || []).length,
    validReferenceRows: canonical.length,
    reviewRequiredRows: (setupRecords || []).filter((row) => text(row.ValidationStatus) === "REVIEW_REQUIRED").length,
    unresolvedReferenceRows: (setupRecords || []).filter((row) => text(row.ValidationStatus) === "UNRESOLVED").length,
    liveConfigurationRows: live.bySku.size,
    duplicateLiveSkus: live.duplicates,
    matches,
    changesRequired,
    missingInLive,
    extraInLive
  };
}

export function buildCanonicalRankingDryRun(setupRecords, rankingRecords) {
  const canonicalSetupBySku = new Map(canonicalSetupRows(setupRecords).map((row) => [text(row.SKU), row]));
  const unresolvedExcluded = (rankingRecords || []).filter((row) => text(row.ValidationStatus) === "UNRESOLVED");
  const missingCanonicalSetup = [];
  const ranked = [];

  (rankingRecords || []).filter((row) => text(row.ValidationStatus) === "VALID").forEach((ranking) => {
    const sku = text(ranking.SKU);
    const setup = canonicalSetupBySku.get(sku);
    if (!setup) {
      missingCanonicalSetup.push({ ranking });
      return;
    }
    ranked.push({
      sku,
      productName: text(ranking.ProductName),
      color: text(ranking.Color),
      size: text(ranking.Size),
      salesQty: number(ranking.SalesQty),
      rank: number(ranking.Rank),
      moving: text(setup.Moving)
    });
  });

  ranked.sort((left, right) => {
    const movingDiff = MOVING_ORDER[left.moving] - MOVING_ORDER[right.moving];
    if (movingDiff) return movingDiff;
    const salesDiff = right.salesQty - left.salesQty;
    if (salesDiff) return salesDiff;
    return ["productName", "color", "size", "sku"].map((key) => left[key].localeCompare(right[key])).find(Boolean) || 0;
  });

  return {
    totalRankingRows: (rankingRecords || []).length,
    validRankingRows: (rankingRecords || []).filter((row) => text(row.ValidationStatus) === "VALID").length,
    unresolvedRankingRows: unresolvedExcluded.length,
    unresolvedExcluded,
    missingCanonicalSetup,
    ranked
  };
}
