// -----------------------------------------------------------------------------
// The only place that touches the network: one HTTPS request, its status and
// its body as text. The client (client.js) takes it as a seam, so the tests
// answer from an in-memory FoxESS Cloud and never reach the network.
// -----------------------------------------------------------------------------

const TIMEOUT_MS = 30_000;

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [options]
 * @returns {Promise<{ status: number, text: string }>}
 */
export async function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, text: await response.text() };
}
