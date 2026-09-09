/**
 * sendCompatibleResponse - Mengirimkan respon HTTP 200 yang identik dengan format Google Apps Script.
 * @param {object} res - Express Response object
 * @param {object} payload - Respon data mentah
 */
export function sendCompatibleResponse(res, payload) {
  // Apps Script selalu merespon status 200 dengan JSON, bahkan jika error.
  // Struktur dasar menyertakan parameter `status` ("success" atau "error").
  const formatted = {
    status: payload.status || "success",
    ...payload
  };

  return res.status(200).json(formatted);
}

/**
 * sendErrorResponse - Helper standar untuk kegagalan controller.
 */
export function sendErrorResponse(res, message, error = null) {
  const payload = {
    status: "error",
    message: message || "Terjadi kesalahan internal pada server backend."
  };

  if (error && process.env.NODE_ENV !== 'production') {
    payload.details = error.toString();
    payload.stack = error.stack;
  }

  return sendCompatibleResponse(res, payload);
}
