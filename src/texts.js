// -----------------------------------------------------------------------------
// Every text the integration shows to the user, in the four languages of the
// Gladys interface (en, fr, de, es). The core picks the user's language and
// falls back on `en`. German says "du", Spanish says "usted", like the rest
// of guim31's integrations. Brands (FoxESS) are not translated.
//
//   - NAMES    : the feature names, in the language of the configuration
//                (Gladys freezes them when the device is added);
//   - TEXT     : the fixed texts (statuses, widget labels, errors);
//   - MESSAGES : the texts built from a value (an action result);
//   - thrown() : a THROWN message reaches the screen as a plain string, the
//                core cannot localize it: the languages are joined.
//
// test/i18n.test.js checks that every entry carries exactly the four
// languages.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

/** Feature names, by language then feature key. `{n}` is a PV string number. */
export const NAMES = {
  en: {
    pv_power: 'Solar power',
    pv_string_power: 'PV string {n}',
    generation_today: 'Production today',
    generation_total: 'Total production',
    load_power: 'House consumption',
    grid_import_power: 'Grid import',
    grid_export_power: 'Grid export',
    grid_import_index: 'Grid import meter',
    grid_export_index: 'Grid export meter',
    battery_level: 'Battery level',
    battery_charge_power: 'Battery charging',
    battery_discharge_power: 'Battery discharging',
    battery_charge_index: 'Battery charge meter',
    battery_discharge_index: 'Battery discharge meter',
    battery_temperature: 'Battery temperature',
    inverter_temperature: 'Inverter temperature',
    status: 'Inverter status',
    alarm: 'Inverter alarm',
    online: 'Online',
  },
  fr: {
    pv_power: 'Production solaire',
    pv_string_power: 'Chaîne PV {n}',
    generation_today: 'Production du jour',
    generation_total: 'Production cumulée',
    load_power: 'Consommation de la maison',
    grid_import_power: 'Soutirage réseau',
    grid_export_power: 'Injection réseau',
    grid_import_index: 'Index de soutirage',
    grid_export_index: "Index d'injection",
    battery_level: 'Niveau de batterie',
    battery_charge_power: 'Charge de la batterie',
    battery_discharge_power: 'Décharge de la batterie',
    battery_charge_index: 'Index de charge batterie',
    battery_discharge_index: 'Index de décharge batterie',
    battery_temperature: 'Température de la batterie',
    inverter_temperature: "Température de l'onduleur",
    status: "État de l'onduleur",
    alarm: "Alarme de l'onduleur",
    online: 'En ligne',
  },
  de: {
    pv_power: 'Solarleistung',
    pv_string_power: 'PV-String {n}',
    generation_today: 'Produktion heute',
    generation_total: 'Gesamtproduktion',
    load_power: 'Hausverbrauch',
    grid_import_power: 'Netzbezug',
    grid_export_power: 'Netzeinspeisung',
    grid_import_index: 'Netzbezugszähler',
    grid_export_index: 'Netzeinspeisezähler',
    battery_level: 'Batteriestand',
    battery_charge_power: 'Batterieladung',
    battery_discharge_power: 'Batterieentladung',
    battery_charge_index: 'Lade-Index Batterie',
    battery_discharge_index: 'Entlade-Index Batterie',
    battery_temperature: 'Batterietemperatur',
    inverter_temperature: 'Wechselrichtertemperatur',
    status: 'Wechselrichterstatus',
    alarm: 'Wechselrichteralarm',
    online: 'Online',
  },
  es: {
    pv_power: 'Potencia solar',
    pv_string_power: 'Cadena FV {n}',
    generation_today: 'Producción de hoy',
    generation_total: 'Producción acumulada',
    load_power: 'Consumo de la casa',
    grid_import_power: 'Importación de la red',
    grid_export_power: 'Exportación a la red',
    grid_import_index: 'Índice de importación',
    grid_export_index: 'Índice de exportación',
    battery_level: 'Nivel de batería',
    battery_charge_power: 'Carga de la batería',
    battery_discharge_power: 'Descarga de la batería',
    battery_charge_index: 'Índice de carga de batería',
    battery_discharge_index: 'Índice de descarga de batería',
    battery_temperature: 'Temperatura de la batería',
    inverter_temperature: 'Temperatura del inversor',
    status: 'Estado del inversor',
    alarm: 'Alarma del inversor',
    online: 'En línea',
  },
};

/** Fixed texts. */
export const TEXT = {
  // Inverter status (the `status` feature, the widget)
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  alarmStatus: { en: 'In alarm', fr: 'En alarme', de: 'Im Alarm', es: 'En alarma' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  selfTest: { en: 'Self-test', fr: 'Autotest', de: 'Selbsttest', es: 'Autoprueba' },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartend', es: 'En espera' },
  checking: { en: 'Checking', fr: 'Vérification', de: 'Prüfung', es: 'Comprobación' },
  onGrid: { en: 'On grid', fr: 'Raccordé au réseau', de: 'Am Netz', es: 'Conectado a la red' },
  offGrid: {
    en: 'Off grid (backup)',
    fr: 'Hors réseau (secours)',
    de: 'Inselbetrieb (Notstrom)',
    es: 'Fuera de red (respaldo)',
  },
  fault: { en: 'Fault', fr: 'Défaut', de: 'Störung', es: 'Fallo' },
  permanentFault: {
    en: 'Permanent fault',
    fr: 'Défaut permanent',
    de: 'Dauerhafte Störung',
    es: 'Fallo permanente',
  },
  standby: { en: 'Standby', fr: 'Veille', de: 'Standby', es: 'En reposo' },
  upgrading: { en: 'Updating', fr: 'Mise à jour', de: 'Aktualisierung', es: 'Actualizando' },
  fct: { en: 'Factory test', fr: 'Test usine', de: 'Werkstest', es: 'Prueba de fábrica' },
  illegal: {
    en: 'Invalid state',
    fr: 'État invalide',
    de: 'Ungültiger Zustand',
    es: 'Estado no válido',
  },
  noAlarm: { en: 'None', fr: 'Aucune', de: 'Keiner', es: 'Ninguna' },

  // Work modes
  SelfUse: { en: 'Self-use', fr: 'Autoconsommation', de: 'Eigenverbrauch', es: 'Autoconsumo' },
  Feedin: {
    en: 'Feed-in first',
    fr: 'Injection prioritaire',
    de: 'Einspeisung zuerst',
    es: 'Exportación prioritaria',
  },
  Backup: { en: 'Backup', fr: 'Secours', de: 'Notstrom', es: 'Respaldo' },

  // Widget
  solar: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  house: { en: 'House', fr: 'Maison', de: 'Haus', es: 'Casa' },
  gridImport: { en: 'From grid', fr: 'Soutirage', de: 'Netzbezug', es: 'De la red' },
  gridExport: { en: 'To grid', fr: 'Injection', de: 'Einspeisung', es: 'A la red' },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  today: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  inverter: { en: 'Inverter', fr: 'Onduleur', de: 'Wechselrichter', es: 'Inversor' },
  workMode: { en: 'Work mode', fr: 'Mode de travail', de: 'Arbeitsmodus', es: 'Modo de trabajo' },
  minSoc: { en: 'Minimum charge', fr: 'Charge minimale', de: 'Mindestladung', es: 'Carga mínima' },
  updated: { en: 'Updated', fr: 'Mis à jour', de: 'Aktualisiert', es: 'Actualizado' },
  idle: { en: 'Idle', fr: 'Au repos', de: 'Ruhend', es: 'En reposo' },
  notConfigured: {
    en: 'Fill in the FoxESS Cloud API key in the configuration of the integration.',
    fr: "Renseignez la clé d'API FoxESS Cloud dans la configuration de l'intégration.",
    de: 'Gib den API-Schlüssel der FoxESS Cloud in der Konfiguration der Integration ein.',
    es: 'Introduzca la clave de API de FoxESS Cloud en la configuración de la integración.',
  },
  pickInverter: {
    en: 'Add an inverter to Gladys (Discovery tab), then pick it in the settings of this widget.',
    fr: 'Ajoutez un onduleur à Gladys (onglet Découverte), puis choisissez-le dans les réglages de ce widget.',
    de: 'Füge einen Wechselrichter zu Gladys hinzu (Reiter Erkennung) und wähle ihn in den Einstellungen dieses Widgets.',
    es: 'Añada un inversor a Gladys (pestaña Descubrimiento) y elíjalo en los ajustes de este widget.',
  },
  noReading: {
    en: 'No reading from the FoxESS Cloud yet.',
    fr: 'Aucune lecture du FoxESS Cloud pour le moment.',
    de: 'Noch keine Messwerte aus der FoxESS Cloud.',
    es: 'Todavía no hay lecturas de FoxESS Cloud.',
  },

  // Configuration screen (connection status)
  notConfiguredStatus: {
    en: 'Fill in the FoxESS Cloud API key.',
    fr: "Renseignez la clé d'API FoxESS Cloud.",
    de: 'Gib den API-Schlüssel der FoxESS Cloud ein.',
    es: 'Introduzca la clave de API de FoxESS Cloud.',
  },
  keyRefused: {
    en: 'The FoxESS Cloud refused the API key (invalid or revoked): create a new one in your FoxESS Cloud profile.',
    fr: "Le FoxESS Cloud refuse la clé d'API (invalide ou révoquée) : créez-en une nouvelle dans votre profil FoxESS Cloud.",
    de: 'Die FoxESS Cloud lehnt den API-Schlüssel ab (ungültig oder widerrufen): Erstelle einen neuen in deinem FoxESS-Cloud-Profil.',
    es: 'FoxESS Cloud rechaza la clave de API (no válida o revocada): cree una nueva en su perfil de FoxESS Cloud.',
  },
  signatureRefused: {
    en: 'The FoxESS Cloud refused the request signature: check the clock of the Gladys server.',
    fr: "Le FoxESS Cloud refuse la signature des requêtes : vérifiez l'horloge du serveur Gladys.",
    de: 'Die FoxESS Cloud lehnt die Signatur der Anfragen ab: Prüfe die Uhr des Gladys-Servers.',
    es: 'FoxESS Cloud rechaza la firma de las solicitudes: compruebe el reloj del servidor Gladys.',
  },
  quotaReached: {
    en: 'FoxESS Cloud call limit reached: readings resume in 30 minutes.',
    fr: "Limite d'appels du FoxESS Cloud atteinte : les lectures reprennent dans 30 minutes.",
    de: 'Aufruflimit der FoxESS Cloud erreicht: Die Messungen gehen in 30 Minuten weiter.',
    es: 'Límite de llamadas de FoxESS Cloud alcanzado: las lecturas se reanudan en 30 minutos.',
  },
  unreachable: {
    en: 'The FoxESS Cloud does not answer: readings resume as soon as it does.',
    fr: 'Le FoxESS Cloud ne répond pas : les lectures reprennent dès son retour.',
    de: 'Die FoxESS Cloud antwortet nicht: Die Messungen gehen weiter, sobald sie antwortet.',
    es: 'FoxESS Cloud no responde: las lecturas se reanudan en cuanto responda.',
  },
  noInverter: {
    en: 'No inverter on this FoxESS Cloud account.',
    fr: 'Aucun onduleur sur ce compte FoxESS Cloud.',
    de: 'Kein Wechselrichter in diesem FoxESS-Cloud-Konto.',
    es: 'No hay ningún inversor en esta cuenta de FoxESS Cloud.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Logs der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },

  // Thrown, joined by thrown(): keep them short.
  controlDisabled: {
    en: 'Inverter control is off in the configuration',
    fr: "Le pilotage de l'onduleur est désactivé dans la configuration",
    de: 'Die Steuerung des Wechselrichters ist in der Konfiguration aus',
    es: 'El control del inversor está desactivado en la configuración',
  },
  unknownInverter: {
    en: 'Unknown inverter',
    fr: 'Onduleur inconnu',
    de: 'Unbekannter Wechselrichter',
    es: 'Inversor desconocido',
  },
  noBattery: {
    en: 'This inverter has no battery',
    fr: "Cet onduleur n'a pas de batterie",
    de: 'Dieser Wechselrichter hat keine Batterie',
    es: 'Este inversor no tiene batería',
  },
  badMode: {
    en: 'Unknown work mode',
    fr: 'Mode de travail inconnu',
    de: 'Unbekannter Arbeitsmodus',
    es: 'Modo de trabajo desconocido',
  },
  badSoc: {
    en: 'Minimum charges between 10 and 100 %, the on-grid one not below the other',
    fr: 'Charges minimales entre 10 et 100 %, celle sur réseau pas en dessous de l’autre',
    de: 'Mindestladungen zwischen 10 und 100 %, die am Netz nicht unter der anderen',
    es: 'Cargas mínimas entre 10 y 100 %, la de red no inferior a la otra',
  },
  scheduleActive: {
    en: 'Refused: a schedule is active in the FoxESS app, turn it off first',
    fr: "Refusé : un planning est actif dans l'application FoxESS, désactivez-le d'abord",
    de: 'Abgelehnt: In der FoxESS-App ist ein Zeitplan aktiv, schalte ihn zuerst aus',
    es: 'Rechazado: hay una programación activa en la app FoxESS, desactívela primero',
  },
  commandFailed: {
    en: 'The FoxESS Cloud refused the command',
    fr: 'Le FoxESS Cloud a refusé la commande',
    de: 'Die FoxESS Cloud hat den Befehl abgelehnt',
    es: 'FoxESS Cloud ha rechazado el comando',
  },
  notConfiguredShort: {
    en: 'API key missing',
    fr: "Clé d'API manquante",
    de: 'API-Schlüssel fehlt',
    es: 'Falta la clave de API',
  },
};

/** Status texts by runningState name (see RUNNING_STATES in foxess/model.js). */
export const RUNNING_STATE_TEXT = {
  selfTest: TEXT.selfTest,
  waiting: TEXT.waiting,
  checking: TEXT.checking,
  onGrid: TEXT.onGrid,
  offGrid: TEXT.offGrid,
  fault: TEXT.fault,
  permanentFault: TEXT.permanentFault,
  standby: TEXT.standby,
  upgrading: TEXT.upgrading,
  fct: TEXT.fct,
  illegal: TEXT.illegal,
};

/** Texts built from a value. */
export const MESSAGES = {
  faults: (count) => ({
    en: `${count} fault(s)`,
    fr: `${count} défaut(s)`,
    de: `${count} Störung(en)`,
    es: `${count} fallo(s)`,
  }),
  charging: (watts) => ({
    en: `Charging, ${watts}`,
    fr: `En charge, ${watts}`,
    de: `Lädt, ${watts}`,
    es: `Cargando, ${watts}`,
  }),
  discharging: (watts) => ({
    en: `Discharging, ${watts}`,
    fr: `En décharge, ${watts}`,
    de: `Entlädt, ${watts}`,
    es: `Descargando, ${watts}`,
  }),
  minSoc: (minSoc, onGrid) => ({
    en: `${minSoc} %, on grid ${onGrid} %`,
    fr: `${minSoc} %, sur réseau ${onGrid} %`,
    de: `${minSoc} %, am Netz ${onGrid} %`,
    es: `${minSoc} %, con red ${onGrid} %`,
  }),
  modeSet: (mode) => ({
    en: `Work mode set: ${TEXT[mode].en}.`,
    fr: `Mode de travail appliqué : ${TEXT[mode].fr}.`,
    de: `Arbeitsmodus gesetzt: ${TEXT[mode].de}.`,
    es: `Modo de trabajo aplicado: ${TEXT[mode].es}.`,
  }),
  minSocSet: (minSoc, onGrid) => ({
    en: `Minimum charge set: ${minSoc} %, on grid ${onGrid} %.`,
    fr: `Charge minimale appliquée : ${minSoc} %, sur réseau ${onGrid} %.`,
    de: `Mindestladung gesetzt: ${minSoc} %, am Netz ${onGrid} %.`,
    es: `Carga mínima aplicada: ${minSoc} %, con red ${onGrid} %.`,
  }),
  serialsMissing: (serials) => ({
    en: `Serial number(s) not on this account: ${serials}.`,
    fr: `Numéro(s) de série absent(s) de ce compte : ${serials}.`,
    de: `Seriennummer(n) nicht in diesem Konto: ${serials}.`,
    es: `Número(s) de serie que no están en esta cuenta: ${serials}.`,
  }),
  testOk: (inverters, quota) => ({
    en: `Connected to the FoxESS Cloud. Inverters: ${inverters}.${quota ? ` API calls left today: ${quota}.` : ''}`,
    fr: `Connecté au FoxESS Cloud. Onduleurs : ${inverters}.${quota ? ` Appels d'API restants aujourd'hui : ${quota}.` : ''}`,
    de: `Mit der FoxESS Cloud verbunden. Wechselrichter: ${inverters}.${quota ? ` Verbleibende API-Aufrufe heute: ${quota}.` : ''}`,
    es: `Conectado a FoxESS Cloud. Inversores: ${inverters}.${quota ? ` Llamadas de API restantes hoy: ${quota}.` : ''}`,
  }),
  testFailed: (reason) => ({
    en: `Connection failed: ${reason.en}`,
    fr: `Échec de la connexion : ${reason.fr}`,
    de: `Verbindung fehlgeschlagen: ${reason.de}`,
    es: `Error de conexión: ${reason.es}`,
  }),
};

/**
 * A message to THROW: the core shows a thrown message as a plain string, so
 * the four languages are joined, then an optional detail common to all of
 * them (an error message) is appended once.
 * @param {{ en: string, fr: string, de: string, es: string }} text
 * @param {string} [detail]
 * @returns {string}
 */
export function thrown(text, detail) {
  const joined = LANGUAGES.map((lang) => text[lang]).join(' / ');
  return detail ? `${joined}: ${detail}` : joined;
}

/** The text of `text` in `language`, English when it is missing. */
export const pick = (text, language) => text[language] ?? text.en;
