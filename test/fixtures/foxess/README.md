# FoxESS Cloud fixtures

Answers of the FoxESS Cloud Open API, rebuilt from the shapes published by
the projects that run against the live API — no capture of a real account
was available while writing this integration:

- the `result[0].datas` envelope of `/op/v1/device/real/query`, with its
  `name` and `unit` fields and the `time` stamp, as documented in
  `API_DEVIATIONS.md` of [nicois/foxess-control](https://github.com/nicois/foxess-control)
  (MIT);
- the variable names (`pvPower`, `pv1Power`, `feedinPower`,
  `gridConsumptionPower`, `loadsPower`, `SoC`, `batTemperature`,
  `invTemperation`, `chargeEnergyToTal`, `runningState`,
  `currentFaultCount`...) of [macxq/foxess-ha](https://github.com/macxq/foxess-ha)
  (Apache 2.0) and [TonyM1958/FoxESS-Cloud](https://github.com/TonyM1958/FoxESS-Cloud)
  (MIT);
- the device list, generation, minimum charge and error envelopes read by
  the same projects, and the error table of the Open API document.

Serial numbers, station ids and names are invented. The values are
plausible readings of a 5 kW hybrid inverter with a battery and of a 10 kW
three-phase inverter without one, at midday.
