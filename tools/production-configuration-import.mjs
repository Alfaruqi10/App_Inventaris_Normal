const REQUIRED_HEADERS = [
  "SKU", "MinimumStock", "TargetStock", "MinimumProductionBatch",
  "Enabled", "Notes", "UpdatedAt", "UpdatedBy"
];

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactIdentity(left, right) {
  return text(left.product) === text(right.product)
    && text(left.color) === text(right.color)
    && text(left.size) === text(right.size);
}

export function rowsToObjects(values) {
  if (!values?.length) return { headers: [], rows: [] };
  const headers = values[0].map(text);
  return {
    headers,
    rows: values.slice(1)
      .filter((row) => row.some((value) => text(value)))
      .map((row, index) => ({
        ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])),
        _row: index + 2
      }))
  };
}

export function buildImportRows(productionRows, setupRows, masterRows) {
  const setupBySku = new Map();
  const masterBySku = new Map();
  const errors = [];

  (setupRows || []).forEach((row) => {
    const sku = text(row.SKU);
    if (!sku) return;
    if (!setupBySku.has(sku)) setupBySku.set(sku, []);
    setupBySku.get(sku).push(row);
  });
  (masterRows || []).forEach((row) => {
    const sku = text(row["Kode Barang"] || row.SKU);
    if (!sku) return;
    if (masterBySku.has(sku)) errors.push({ sku, code: "DUPLICATE_MASTER_SKU" });
    else masterBySku.set(sku, { sku, product: text(row["Nama Barang"] || row.ProductName), color: text(row.Warna || row.Color), size: text(row.Ukuran || row.Size) });
  });

  const records = (productionRows || []).map((source) => {
    const sku = text(source.sku || source.SKU);
    const product = text(source.product || source.ProductName);
    const color = text(source.color || source.Color);
    const size = text(source.size || source.Size);
    const master = masterBySku.get(sku);
    const candidates = (setupBySku.get(sku) || []).filter((setup) => exactIdentity({ product, color, size }, {
      product: setup.ProductName, color: setup.Color, size: setup.Size
    }));
    const batch = candidates.length === 1 ? number(candidates[0].ProductionMinimum) : null;
    const minimumStock = number(source.minimum ?? source.MinimumStock);
    const targetStock = number(source.target ?? source.TargetStock);
    const validation = [];
    if (!master || !exactIdentity({ product, color, size }, master)) validation.push("UNRESOLVED_MASTER_IDENTITY");
    if (candidates.length === 0) validation.push("MISSING_EXACT_SETUP_MATCH");
    if (candidates.length > 1) validation.push("AMBIGUOUS_EXACT_SETUP_MATCH");
    if (minimumStock === null || minimumStock < 0) validation.push("INVALID_MINIMUM_STOCK");
    if (targetStock === null || targetStock < minimumStock) validation.push("INVALID_TARGET_STOCK");
    if (batch === null || batch <= 0) validation.push("INVALID_MINIMUM_PRODUCTION_BATCH");
    return { sku, product, color, size, minimumStock, targetStock, minimumProductionBatch: batch, validation };
  });
  return { records, errors };
}

export function planProductionConfigurationImport({ referenceRecords, existingRows, headers }) {
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !new Set(headers || []).has(header));
  const existingBySku = new Map();
  const duplicates = [];
  (existingRows || []).forEach((row) => {
    const sku = text(row.SKU);
    if (!sku) return;
    if (existingBySku.has(sku)) duplicates.push(sku);
    else existingBySku.set(sku, row);
  });

  const invalidReference = (referenceRecords || []).filter((row) => row.validation?.length);
  const inserts = [];
  const updates = [];
  (referenceRecords || []).forEach((reference) => {
    const existing = existingBySku.get(reference.sku);
    if (existing) updates.push({ reference, existing });
    else inserts.push(reference);
  });

  return {
    headers: headers || [],
    missingHeaders,
    existingRows: existingBySku.size,
    duplicateSkus: duplicates,
    invalidReference,
    inserts,
    updates,
    writeAllowed: !missingHeaders.length && !duplicates.length && !invalidReference.length
  };
}

export function configurationValues(records, updatedAt, updatedBy) {
  return (records || []).map((record) => [
    record.sku,
    record.minimumStock,
    record.targetStock,
    record.minimumProductionBatch,
    true,
    "",
    updatedAt,
    updatedBy
  ]);
}

export { REQUIRED_HEADERS };
