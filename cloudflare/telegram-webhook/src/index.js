const SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function constantTimeEqual(actual, expected) {
  const left = String(actual || "");
  const right = String(expected || "");
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function getGasExecUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const valid = url.protocol === "https:"
      && url.hostname.toLowerCase() === "script.google.com"
      && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
    return valid ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== "/telegram-webhook") {
      return jsonResponse(404, { ok: false, error: "not_found" });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "method_not_allowed" });
    }

    const expectedSecret = String(env.TELEGRAM_WEBHOOK_SECRET || "");
    const gasExecUrl = getGasExecUrl(env.GAS_EXEC_URL);
    if (!expectedSecret || !gasExecUrl) {
      return jsonResponse(503, { ok: false, error: "relay_unavailable" });
    }

    if (!constantTimeEqual(request.headers.get(SECRET_HEADER), expectedSecret)) {
      return jsonResponse(401, { ok: false, error: "unauthorized" });
    }

    const body = await request.text();
    try {
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid update");
    } catch (_) {
      return jsonResponse(400, { ok: false, error: "invalid_update" });
    }

    try {
      // Telegram receives this Worker's response. Any GAS redirect is followed
      // only by the Worker's outbound request and is never exposed to Telegram.
      const upstream = await fetch(gasExecUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body,
        redirect: "follow",
      });
      if (!upstream.ok) return jsonResponse(502, { ok: false, error: "upstream_failed" });
      const upstreamBody = await upstream.text();
      const upstreamResult = JSON.parse(upstreamBody || "{}");
      if (upstreamResult.status === "error") return jsonResponse(502, { ok: false, error: "upstream_failed" });
    } catch (_) {
      return jsonResponse(502, { ok: false, error: "upstream_failed" });
    }

    return jsonResponse(200, { ok: true });
  },
};
