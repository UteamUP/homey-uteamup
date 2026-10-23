# UteamUP for Homey

Bring your UteamUP maintenance work into Homey. See open and overdue work orders, stock and IoT
alerts, and let Flows report problems, complete work, set asset states and record meter readings.
This is the Homey counterpart of [UteamUP for Home Assistant](https://github.com/UteamUP/ha-uteamup)
and uses the same API key and the same UteamUP API.

The app runs on **Homey Pro** (Homey 12.3 or newer). It is built to also run on Homey Cloud; see
[Homey Cloud](#homey-cloud).

## Quick setup

You need a UteamUP company on the **Premium** or **Enterprise** plan, and permission to manage it.

1. In UteamUP, open **Tenant Management → API Keys** and click **Create API Key**. Don't use the
   **MCP Keys** tab: those keys are for AI assistants and Homey can't use them.
2. Name it *Homey*, choose a role (see [the permission list](#what-the-key-may-do)) and click
   **Create Key**. Copy the **key** and the **secret**; UteamUP shows the secret only once.
3. In the Homey app, tap **+ → New device → UteamUP → UteamUP company**.
4. Leave the API address as `https://api.uteamup.com`, paste the key and the secret, and tap
   **Connect**.

Anything Homey does in UteamUP is recorded under the name of the person who created the key.

## What you get

| Type | What |
|------|------|
| Device values | Open, in progress, on hold and overdue work orders; stock alerts; critical stock; unacknowledged IoT alerts; IoT alert active |
| Triggers | The number of overdue work orders changed · An IoT alert became active · Stock became critical · An event arrived from UteamUP |
| Conditions | Overdue work orders are above a number · An IoT alert is active |
| Actions | Create a work order · Report a problem · Set a work order status · Complete a work order · Set an asset state · Run preventive maintenance now · Record a meter reading · Add a line to a journal |

The values refresh every two minutes (30 to 3600 seconds in the device settings). Work order
choices in the status and complete actions list the open work orders; the device setting **Only
work orders assigned to** narrows them to one person.

### Example Flow

*When* a leak sensor's water alarm turns on, *then* **UteamUP: Report a problem** with
description *Water detected in the boiler room*, severity *Critical* and the boiler's asset GUID.

## What the key may do

| To use | The role needs |
|--------|----------------|
| Work order counts | `Analytics.View`, `WorkOrder.View` |
| Stock alerts | `Stock.View` |
| IoT alerts | `IOT.View` |
| Work order choices | `WorkOrder.View` |
| Create work orders and report problems | `WorkOrder.Create` |
| Change status | `WorkOrder.Update` |
| Complete work orders | `WorkOrder.Complete` |
| Set asset state | `Asset.SetOperationalState` |
| Run preventive maintenance | `WorkOrderTemplate.Update` and `WorkOrder.Create` |
| Record meter readings | `MeterReading.Update` |
| Add journal lines | `Journal.View` and `Journal.Update` |
| Live events | `Webhook.View` and `Webhook.Manage` (Enterprise plan) |

An action is allowed only when **both** the key's role **and** the person who created the key hold
the permission. Values the key may not read stay empty.

## Live events

With **Receive live events** on (the default), each device registers a UteamUP webhook that points
at Athom's webhook forwarder (`https://webhooks.athom.com/webhook/<id>?homey=<homeyId>&tenant=<guid>`),
so Homey needs no public address. Each device uses its own random secret.

UteamUP signs every delivery with HMAC-SHA256 over the raw body. The forwarder hands the app a parsed
body, so the app re-serializes it the way UteamUP's System.Text.Json does before checking the
signature. Only a verified delivery fires **An event arrived from UteamUP**, once per delivery id. An
unverified delivery carries no data into Flows; it only makes the device re-read UteamUP through its
own authenticated API, at most every 10 seconds. If a payload ever re-serializes differently (for
example a decimal written with trailing zeros), that delivery is not verified and the values still
update.

Live events need a webhook registered in Athom's Developer Tools; the ID and secret are build
secrets in `env.json` (see `env.json.example`). A build without them simply polls.

## Homey Cloud

The app follows the Homey Cloud rules already: credentials are collected while pairing (no app
settings page), there is no app Web API, no global state, timers go through `this.homey`, and the
manifest passes `homey app validate --level verified`. To publish for Cloud, which needs a Homey
Verified Developer subscription:

1. Set `"platforms": ["local", "cloud"]` in `.homeycompose/app.json`, in
   `drivers/company/driver.compose.json` and on each card in `drivers/company/driver.flow.compose.json`.
2. Run `homey app validate --level verified` and test with a Cloud Homey selected (`homey app run`).

## Development

```bash
npm ci
npm test                         # unit tests, no network
npx homey app validate --level publish
npx homey app run                # on a Homey Pro on your network; needs `homey login`
```

`test/live.test.js` signs in to a real UteamUP API and is skipped unless `UTEAMUP_LIVE_KEY_FILE`
points at a JSON file with `base`, `apiKey` and `secret`. Use the development API, never production.
It only reads.

Image sources are in `docs/image-sources/`; store texts and the review checklist are in
`docs/store-submission.md`.

## License

MIT. See [LICENSE](LICENSE).
