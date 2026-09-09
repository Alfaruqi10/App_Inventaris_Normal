/*
 * SELF-CONTAINED, READ-ONLY browser-session audit.
 * Paste this entire file once into the logged-in Inventory app DevTools Console.
 * Then run: const audit = await runStockProductionSnapshotAudit();
 *
 * The harness permits only the two read actions already used by ProductionCenter.
 */
(function installStockProductionSnapshotAudit(global) {
  "use strict";

  const READ_ACTIONS = new Set(["getProductionConfigurations", "getStockProductionDashboard"]);
  const MOVING_VALUES = new Set(["FAST", "MIDDLE", "SLOW"]);

  function text(value) { return String(value == null ? "" : value).trim(); }
  function upper(value) { return text(value).toUpperCase(); }
  function numeric(value) {
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  function valueOf(row, keys) {
    for (const key of keys) {
      if (row && Object.prototype.hasOwnProperty.call(row, key) && row[key] !== "" && row[key] != null) return row[key];
    }
    return null;
  }
  function requireArray(value, label) {
    if (!Array.isArray(value)) throw new Error(label + " harus berupa array.");
    return value;
  }
  function sessionEmail() {
    const raw = global.localStorage.getItem("inventarisUser");
    if (!raw) throw new Error("Session inventarisUser tidak tersedia. Login terlebih dahulu.");
    let user;
    try { user = JSON.parse(raw); } catch (_) { throw new Error("Session inventarisUser tidak valid."); }
    if (!user || !text(user.email)) throw new Error("Session pengguna tidak memiliki email.");
    return text(user.email);
  }
  function assertReadAction(action) {
    if (!READ_ACTIONS.has(action)) throw new Error("Audit menolak action non-read-only: " + action);
  }
  function rowsBySku(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const sku = text(valueOf(row, ["sku", "SKU"]));
      if (sku) map.set(sku, row);
    });
    return map;
  }
  function countMoving(rows, getter) {
    return rows.reduce((counts, row) => {
      const moving = upper(getter(row));
      if (MOVING_VALUES.has(moving)) counts[moving] += 1;
      return counts;
    }, { FAST: 0, MIDDLE: 0, SLOW: 0 });
  }
  function expectedFormula(config, evaluator, queue) {
    const stock = numeric(evaluator.stock);
    const minimum = numeric(config.minimumStock);
    const target = numeric(config.targetStock);
    const batch = numeric(config.minimumProductionBatch);
    if ([stock, minimum, target, batch].some((value) => value === null)) return { valid: false, reason: "INVALID_NUMERIC_INPUT" };
    const enabled = config.enabled === true || upper(config.enabled) === "TRUE";
    const active = enabled && stock <= minimum;
    const shortage = Math.max(0, target - stock);
    const productionQty = active ? Math.max(shortage, batch) : 0;
    const queueStatus = upper(valueOf(queue, ["Status", "status"]));
    const status = !active ? "NORMAL" : (queueStatus === "IN_PROGRESS" ? "PRODUCTION_IN_PROGRESS" : (stock < minimum ? "CRITICAL" : "PRODUCTION_REQUIRED"));
    return { valid: true, productionQty, status };
  }
  function compareConfig(config, evaluator) {
    return numeric(config.minimumStock) === numeric(evaluator.minimumStock) &&
      numeric(config.targetStock) === numeric(evaluator.productionTarget) &&
      numeric(config.minimumProductionBatch) === numeric(evaluator.productionMin) &&
      upper(config.moving) === upper(evaluator.movingStat);
  }
  function snapshotValueChanged(currentValue, nextValue) {
    const currentNumber = numeric(currentValue);
    const nextNumber = numeric(nextValue);
    if (currentNumber !== null && nextNumber !== null) return currentNumber !== nextNumber;
    return text(currentValue) !== text(nextValue);
  }
  function pendingQueueChanges(queue, evaluator) {
    const desired = {
      StockAtCreation: evaluator.stock,
      MinimumStock: evaluator.minimumStock,
      IdealStock: evaluator.idealStock,
      ProductionMin: evaluator.productionMin,
      ProductionTarget: evaluator.productionTarget,
      RecommendedQty: evaluator.productionQty,
      PlannedQty: evaluator.productionQty,
      MovingStat: evaluator.movingStat,
      Priority: evaluator.priority
    };
    return Object.keys(desired).reduce((changes, field) => {
      if (snapshotValueChanged(valueOf(queue, [field, field[0].toLowerCase() + field.slice(1)]), desired[field])) changes[field] = desired[field];
      return changes;
    }, {});
  }
  function classifyQueueComparison(queue, evaluator) {
    if (!queue) return { result: "MISSING_PENDING_QUEUE", action: "MISSING_QUEUE", changes: {} };
    const status = upper(valueOf(queue, ["Status", "status"]));
    const changes = pendingQueueChanges(queue, evaluator);
    const matches = Object.keys(changes).length === 0;
    if (status === "PENDING") {
      return {
        result: matches ? "PASS" : "MISMATCH",
        action: matches ? "NO_CHANGE" : "WOULD_UPDATE",
        changes
      };
    }
    return { result: matches ? "PASS" : "STALE_BY_LIFECYCLE", action: "SKIP_LIFECYCLE", changes };
  }
  async function read(action, payload) {
    assertReadAction(action);
    if (typeof global.postData !== "function") throw new Error("postData() tidak tersedia pada halaman ini.");
    return global.postData(Object.assign({ action, callerEmail: sessionEmail() }, payload || {}));
  }

  global.runStockProductionSnapshotAudit = async function runStockProductionSnapshotAudit(options) {
    try {
      options = options || {};
      const configResponse = await read("getProductionConfigurations", { page: 1, pageSize: 100 });
      const dashboardResponse = await read("getStockProductionDashboard", { page: 1, pageSize: 100 });
      if (!configResponse || configResponse.status !== "success") throw new Error("Configuration read gagal: " + text(configResponse && configResponse.message));
      if (!dashboardResponse || dashboardResponse.status !== "success") throw new Error("Dashboard read gagal: " + text(dashboardResponse && dashboardResponse.message));

      const configBySku = rowsBySku(requireArray(configResponse.rows, "configuration.rows"));
      const evaluatorRows = requireArray(dashboardResponse.items, "dashboard.items");
      const queueRows = requireArray(dashboardResponse.queue, "dashboard.queue");
      const queueBySku = rowsBySku(queueRows);
      const matrix = evaluatorRows.map((evaluator) => {
        const sku = text(valueOf(evaluator, ["sku", "SKU"]));
        if (!sku) throw new Error("Evaluator row tanpa SKU.");
        const config = configBySku.get(sku);
        const queue = queueBySku.get(sku) || null;
        const queueStatus = upper(valueOf(queue, ["Status", "status"]));
        const formula = config ? expectedFormula(config, evaluator, queue) : { valid: false, reason: "MISSING_CONFIGURATION" };
        const configMatch = !!config && compareConfig(config, evaluator);
        const formulaMatch = formula.valid && numeric(evaluator.productionQty) === formula.productionQty && upper(evaluator.status) === formula.status;
        const queueComparison = classifyQueueComparison(queue, evaluator);
        const movingMatch = !!config && upper(config.moving) === upper(evaluator.movingStat);
        const overall = !configMatch || !formulaMatch || queueComparison.result === "MISMATCH" || queueComparison.result === "MISSING_PENDING_QUEUE" ? "RUNTIME_BUG" : queueComparison.result === "STALE_BY_LIFECYCLE" ? "STALE_BY_LIFECYCLE" : "PASS";
        return {
          SKU: sku,
          "Config Moving": config ? config.moving : "MISSING",
          "Evaluator Moving": evaluator.movingStat,
          "Evaluator Stock": evaluator.stock,
          Minimum: evaluator.minimumStock,
          Ideal: evaluator.productionTarget,
          "Min Batch": evaluator.productionMin,
          "Production Qty": evaluator.productionQty,
          "Evaluator Status": evaluator.status,
          Alert: "NOT_EXPOSED_BY_READ_API",
          "Old Moving": queue ? valueOf(queue, ["MovingStat", "movingStat"]) : "-",
          "New Moving": evaluator.movingStat,
          "Old ProductionQty": queue ? valueOf(queue, ["RecommendedQty", "recommendedQty"]) : "-",
          "New ProductionQty": evaluator.productionQty,
          "Old RecommendedQty": queue ? valueOf(queue, ["RecommendedQty", "recommendedQty"]) : "-",
          "New RecommendedQty": evaluator.productionQty,
          "Queue Moving": queue ? valueOf(queue, ["MovingStat", "movingStat"]) : "-",
          "Queue Production Qty": queue ? valueOf(queue, ["RecommendedQty", "recommendedQty"]) : "-",
          "Queue Status": queueStatus || "-",
          "Config Match": configMatch ? "PASS" : "MISMATCH",
          "Moving Match": movingMatch ? "PASS" : "MISMATCH",
          "Formula Match": formulaMatch ? "PASS" : (formula.reason || "MISMATCH"),
          "Queue Match": queueComparison.result,
          "Changed Fields": Object.keys(queueComparison.changes).join(", ") || "-",
          Action: queueComparison.action,
          Overall: overall
        };
      });
      const pendingRows = matrix.filter((row) => row["Queue Status"] === "PENDING");
      const queueRowsByStatus = {
        pending: queueRows.filter((row) => upper(valueOf(row, ["Status", "status"])) === "PENDING").length,
        inProgress: queueRows.filter((row) => upper(valueOf(row, ["Status", "status"])) === "IN_PROGRESS").length,
        terminalExposed: queueRows.filter((row) => {
          const status = upper(valueOf(row, ["Status", "status"]));
          return status && status !== "PENDING" && status !== "IN_PROGRESS";
        }).length
      };
      const summary = {
        totalSku: matrix.length,
        totalActiveSku: matrix.length,
        pass: matrix.filter((row) => row.Overall === "PASS").length,
        mismatch: matrix.filter((row) => row.Overall === "RUNTIME_BUG").length,
        staleByLifecycle: matrix.filter((row) => row.Overall === "STALE_BY_LIFECYCLE").length,
        missingAlert: matrix.length,
        missingPendingQueue: matrix.filter((row) => row["Queue Match"] === "MISSING_PENDING_QUEUE").length,
        pendingQueue: queueRowsByStatus.pending,
        wouldUpdate: pendingRows.filter((row) => row.Action === "WOULD_UPDATE").length,
        noChange: pendingRows.filter((row) => row.Action === "NO_CHANGE").length,
        skippedLifecycle: matrix.filter((row) => row.Action === "SKIP_LIFECYCLE").length,
        movingChanges: pendingRows.filter((row) => text(row["Changed Fields"]).split(", ").indexOf("MovingStat") >= 0).length,
        productionQtyChanges: pendingRows.filter((row) => {
          const fields = text(row["Changed Fields"]).split(", ");
          return fields.indexOf("RecommendedQty") >= 0 || fields.indexOf("PlannedQty") >= 0;
        }).length,
        pendingNoChange: pendingRows.filter((row) => row.Action === "NO_CHANGE").length,
        pendingWouldUpdate: pendingRows.filter((row) => row.Action === "WOULD_UPDATE").length,
        inProgressQueue: queueRowsByStatus.inProgress,
        terminalQueueExposed: queueRowsByStatus.terminalExposed,
        queueMatch: matrix.filter((row) => row["Queue Match"] === "PASS").length,
        configMatch: matrix.filter((row) => row["Config Match"] === "PASS").length,
        formulaMatch: matrix.filter((row) => row["Formula Match"] === "PASS").length,
        movingMatch: matrix.filter((row) => row["Moving Match"] === "PASS").length,
        alertVerification: "NOT_EXPOSED_BY_READ_API",
        queueReadScope: "ACTIVE_ONLY",
        evaluatorMoving: countMoving(evaluatorRows, (row) => row.movingStat),
        queueMoving: countMoving(queueRows, (row) => valueOf(row, ["MovingStat", "movingStat"]))
      };
      const verdict = summary.mismatch > 0 ? "SNAPSHOT_RECONCILIATION_RUNTIME_BUG" :
        (summary.staleByLifecycle > 0 ? "SNAPSHOT_RECONCILIATION_HAS_STALE_SNAPSHOTS" : "SNAPSHOT_RECONCILIATION_PASS");
      const result = { mode: "READ_ONLY_BROWSER_SESSION", callerEmail: sessionEmail(), actions: Array.from(READ_ACTIONS), summary, verdict, matrix };
      if (!options.silent) {
        global.console.table(matrix);
        global.console.log("Stock Production snapshot audit summary", summary);
        global.console.log("Stock Production snapshot audit verdict", verdict);
      }
      return result;
    } catch (error) {
      const result = { mode: "READ_ONLY_BROWSER_SESSION", status: "error", message: error && error.message ? error.message : String(error), actions: Array.from(READ_ACTIONS), matrix: [] };
      global.console.error("Stock Production snapshot audit failed", result);
      return result;
    }
  };

  global.runPendingQueueRefreshDryRun = async function runPendingQueueRefreshDryRun() {
    const audit = await global.runStockProductionSnapshotAudit({ silent: true });
    if (audit.status === "error") return audit;
    const details = audit.matrix.filter((row) => row["Queue Status"] === "PENDING" && row.Action === "WOULD_UPDATE").map((row) => ({
      SKU: row.SKU,
      "Queue Status": row["Queue Status"],
      "Old RecommendedQty": row["Old RecommendedQty"],
      "New RecommendedQty": row["New RecommendedQty"],
      "Old MovingStat": row["Old Moving"],
      "New MovingStat": row["New Moving"],
      "Changed Fields": row["Changed Fields"]
    }));
    const result = {
      mode: "READ_ONLY_PENDING_QUEUE_REFRESH_DRY_RUN",
      totalActiveSku: audit.summary.totalActiveSku,
      pendingQueue: audit.summary.pendingQueue,
      wouldUpdate: details.length,
      noChange: audit.summary.noChange,
      skippedLifecycle: audit.summary.skippedLifecycle,
      details
    };
    global.console.table(details);
    global.console.log("Pending Queue refresh dry-run summary", result);
    return result;
  };

  global.console.log("Installed runStockProductionSnapshotAudit() and runPendingQueueRefreshDryRun(). Both are read-only.");
})(typeof window !== "undefined" ? window : globalThis);
