# Gladys FoxESS

FoxESS inverters and batteries (H1, H3, KH, AIO, T and F series…) in
[Gladys Assistant](https://gladysassistant.com), through the official **FoxESS Cloud Open API**.

> **Developed without the hardware: feedback welcome.** The answers of the API come from its
> documentation and from the open source projects that run against it (see [Credits](#credits)).
> Not affiliated with FoxESS.

## What it does

- **One device per inverter** of the FoxESS Cloud account: solar power (total and per PV string),
  production of the day and lifetime production index, house consumption, grid import and export
  (power and meters), battery level, charge and discharge power and meters, battery and inverter
  temperatures, inverter status, current alarm, online.
- A **dashboard widget** (Gladys 5.1+) with the flows of an inverter, its battery and its work mode.
- An **`inverter_fault` scene trigger** when the inverter reports a new fault, with its description.
- Optional **control**, off by default: scene actions and widget buttons for the **work mode**
  (self-use, feed-in first, backup) and the **minimum battery charge**, through the official Open API
  endpoints (`setting/set` with `WorkMode`, `battery/soc/set`).
- A **Test the connection** action: the inverters of the account and the API calls left today.

User documentation: [English](docs/en.md), [Français](docs/fr.md), [Deutsch](docs/de.md),
[Español](docs/es.md).

## Requirements

- Gladys Assistant **5.1.0** or later.
- A FoxESS Cloud account and its **API key**: on foxesscloud.com, profile (top right), **User
  Profile**, **API Management**, **Generate API key**.
- Internet access and a clock on time on the Gladys server (the requests are signed with the time).

## Installation

In Gladys: **Integrations → Install from GitHub**, then `https://github.com/guim31/gladys-foxess`
(or install it from the store once it is listed). Fill in the API key in the configuration, click
**Test the connection**, then add the inverters from the **Discovery** tab.

## How it works

- **Cloud only** (`transports: ["cloud"]`): the container calls `https://www.foxesscloud.com/op/…`
  with the API key in the `token` header, the time in `timestamp`, and `signature`, the MD5 of
  `path + "\r\n" + key + "\r\n" + timestamp` where `\r\n` is four **literal** characters (real CRLF
  bytes are refused with errno 40256 — a deviation from the Open API document).
- **Quota**: the Open API allows **1,440 calls a day** and refuses bursts. The integration reads
  on its own timer (5 minutes by default, the pace the cloud itself refreshes at): one real-time
  call for all inverters per cycle, the device list and the production of the day every 15
  minutes, the minimum charge and work mode every hour. That is **528 calls a day** for one
  inverter with a battery at 5 minutes. A quota or burst refusal pauses the readings for 30
  minutes; a refused key, for an hour or until the configuration changes.
- **No core polling**: the devices are published with `should_poll: false`; the core does not
  poll external devices reliably (Gladys#3198), and no poll frequency it offers fits the quota.
- Nothing is stored in `/data`; the API key lives in the Gladys configuration (a `secret` field)
  and never reaches the logs.

## Limits

- No local (Modbus) access: for that, see `foxess_modbus` for Home Assistant.
- The FoxESS Cloud refreshes about every 5 minutes: readings are never real time.
- The forced charge/discharge windows and the scheduler of the FoxESS app are not offered, nor
  the export limit or the battery heating. A schedule active in the FoxESS app makes the inverter
  refuse the work mode and minimum charge commands (errno 44096).
- The house consumption index is not published (only its power), so that the energy tracking does
  not price self-consumed solar as grid energy.
- Gladys 5.2.1 derives the 30-minute production automatically from consumption indexes only: the
  lifetime production index is stored with its history.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
node scripts/probe.mjs                         # real cloud, fake key: expects "key refused"
FOXESS_API_KEY=<key> node scripts/probe.mjs    # real cloud, read-only, nothing sensitive printed
npx github:GladysAssistant/integration-store . # store admission checks
```

The tests run against the fake Gladys of the SDK and an in-memory FoxESS Cloud
(`test/helpers/fakeFoxess.js`) that checks the signature like the real one; they never touch the
network. See [`CLAUDE.md`](CLAUDE.md) for the project rules and the pitfalls already met.

### Publishing

Versions belong to the **Release** workflow (Actions → Release → Run workflow): it bumps
`package.json`, the manifest `version` and the `docker_image` tag, rolls `CHANGELOG.md`, tags,
builds the multi-arch image to `ghcr.io/guim31/gladys-foxess` and publishes the GitHub Release.

> A hand-pushed tag (`git tag vX.Y.Z && git push --tags`) builds the image and the Release too, but
> does not touch the files: bump `version` in `package.json` and in
> `gladys-assistant-integration.json` (with the `docker_image` tag) and commit it **before**
> tagging.

## Credits

- [macxq/foxess-ha](https://github.com/macxq/foxess-ha) (Apache 2.0), the Home Assistant
  integration for the FoxESS Cloud: the variable names, the polling cadence, the running state
  codes.
- [TonyM1958/FoxESS-Cloud](https://github.com/TonyM1958/FoxESS-Cloud) (MIT): the endpoints of the
  Open API (settings, minimum charge, access count) and the error code table.
- [nicois/foxess-control](https://github.com/nicois/foxess-control) (MIT): the documented
  deviations of the live API (literal `\r\n` signature, `result[].datas` shape).
- [nathanmarlor/foxess_modbus](https://github.com/nathanmarlor/foxess_modbus) for the vocabulary
  of the work modes.
- Built on the Gladys [integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and
  its JavaScript template.

No code was copied from these projects: the integration is written in JavaScript from what they
document.

## License

[Apache-2.0](LICENSE). Not affiliated with FoxESS; FoxESS is a trademark of its owner.
