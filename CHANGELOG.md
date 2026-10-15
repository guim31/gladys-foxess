# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- FoxESS inverters and batteries through the official FoxESS Cloud Open API, with an API key:
  every inverter of the account, or the serial numbers chosen in the configuration.
- One device per inverter: solar power (total and per PV string), production of the day, lifetime
  production index, house consumption, grid import and export (power and meters), battery level,
  charge and discharge power and meters, battery and inverter temperatures, inverter status,
  current alarm, online.
- Readings every 5 minutes by default (up to 1 hour), within the 1,440 daily calls of the Open
  API (528 a day for one inverter with a battery); a quota refusal pauses the readings for 30
  minutes and says so in the Configuration screen.
- "FoxESS solar" dashboard widget: solar, house, grid, battery, inverter status, minimum charge,
  work mode, time of the reading.
- "Inverter fault" scene trigger, with the fault description from FoxESS.
- "Set the inverter work mode" and "Set the minimum battery charge" scene actions, and work mode
  buttons in the widget, refused until "Allow inverter control" is turned on.
- "Test the connection" action: the inverters of the account and the API calls left today.
- Texts, feature names and documentation in English, French, German and Spanish.
- A key the FoxESS Cloud gateway refuses with HTTP 401 or 403 shows as a refused API key
  (invalid or revoked) in the Configuration screen, not as the cloud being unreachable.

[Unreleased]: https://github.com/guim31/gladys-foxess/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-foxess/releases/tag/v1.0.1
