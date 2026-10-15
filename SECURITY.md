# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **The FoxESS Cloud API key**, typed in the Gladys configuration (a `secret` field: Gladys never
  sends it back to the browser). It stays in the memory of the container, goes only to
  `https://www.foxesscloud.com` in the `token` header of the signed requests, and is never
  written to the logs, at any level.
- **Nothing is stored in `/data`**: the readings live in memory and are read again at start-up.
- **Network**: outbound HTTPS to `www.foxesscloud.com` only; the container listens on no port.
- **Commands**: changing the work mode or the minimum battery charge is off by default
  ("Allow inverter control"); the widget buttons ask for a confirmation.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the FoxESS Cloud and the inverters the integration talks to (report those to FoxESS).
