// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in minutes. The FoxESS
// Cloud refreshes its own data about every 5 minutes and allows 1,440 Open
// API calls a day: reading faster gives the same numbers and burns the quota.
export const REFRESH_MINUTES = ['5', '10', '15', '30', '60'];

/** Highest PV string number the Open API reports (pv1Power ... pv18Power). */
export const MAX_PV_STRINGS = 18;

export const DEFAULT_CONFIG = {
  api_key: '',
  serial_numbers: '',
  refresh_minutes: '5',
  pv_strings: 0,
  allow_control: false,
  language: 'fr',
};

/**
 * Split the serial numbers typed by the user: commas, semicolons, spaces or
 * line breaks, upper-cased (the portal shows them upper-case), duplicates
 * dropped.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseSerialNumbers(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const serials = raw
    .split(/[\s,;]+/)
    .map((serial) => serial.trim().toUpperCase())
    .filter((serial) => /^[A-Z0-9]{6,32}$/.test(serial));
  return [...new Set(serials)];
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const refresh = REFRESH_MINUTES.includes(String(source.refresh_minutes))
    ? String(source.refresh_minutes)
    : DEFAULT_CONFIG.refresh_minutes;
  const strings = Number.parseInt(source.pv_strings, 10);
  return {
    // The key is kept as typed, only the surrounding blanks of a paste dropped.
    apiKey: typeof source.api_key === 'string' ? source.api_key.trim() : '',
    serialNumbers: parseSerialNumbers(source.serial_numbers),
    refreshMs: Number(refresh) * 60_000,
    pvStrings:
      Number.isInteger(strings) && strings >= 0 && strings <= MAX_PV_STRINGS
        ? strings
        : DEFAULT_CONFIG.pv_strings,
    allowControl: source.allow_control === true || source.allow_control === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** True once an API key is filled in. */
export const isConfigured = (config) => config.apiKey !== '';
