# Homey App Store submission — UteamUP

Everything Athom asks for, ready to paste. Steps marked **(you)** need the UteamUP Athom account and
can only be done by a person signed in to it.

## Listing

| Field | English | Icelandic |
|-------|---------|-----------|
| App ID | `com.uteamup` | |
| Name | UteamUP | UteamUP |
| Description (one line) | Keep maintenance work in step with your home and building | Haltu viðhaldinu í takt við heimilið og bygginguna |
| Category | Tools | |
| Brand color | `#206BB5` (UteamUP blue, the cube's right face) | |
| Readme | `README.txt` | `README.is.txt` |
| Tags | maintenance, work order, cmms, facility, building, alerts, meter | viðhald, verkbeiðni, fasteign, bygging, viðvaranir, mælir |
| Homepage | https://uteamup.com | |
| Support | mailto:support@uteamup.com | |
| Source | https://github.com/UteamUP/homey-uteamup | |
| Issues | https://github.com/UteamUP/homey-uteamup/issues | |
| Platforms | Homey Pro (`local`); Cloud-ready, not enabled | |
| Permissions | none | |
| Price | free (connects to a paid UteamUP plan, which the guidelines allow) | |

Check `support@uteamup.com` is a monitored address before submitting.

## Images and icons (in the repo)

| Asset | File | Size |
|-------|------|------|
| App image small / large / xlarge | `assets/images/small.png`, `large.png`, `xlarge.png` | 250×175, 500×350, 1000×700 |
| Driver image small / large / xlarge | `drivers/company/assets/images/…` | 75×75, 500×500, 1000×1000 on white |
| App icon | `assets/icon.svg` | 960×960, transparent, the cube |
| Driver icon | `drivers/company/assets/icon.svg` | 960×960, transparent, a work order clipboard |

The app image is an illustration (house, leak, work order card, alert bell), not the logo, and
nothing shows the Homey logo or a Homey device. Sources: `docs/image-sources/*.svg`, rendered with
headless Chrome and resized with `sips`.

## Privacy note (for the submission form and the store page)

The app sends requests only to the UteamUP API address entered while pairing (by default
`https://api.uteamup.com`). It stores the API key, its secret and, with live events on, a random
webhook secret in the device's store on the Homey; nothing is sent to Athom except UteamUP's webhook
deliveries passing through Athom's webhook forwarder. It reads work order, stock and IoT alert counts
and open work order names, and writes only what a Flow action asks for. Removing the device deletes
the UteamUP webhook subscription. UteamUP's privacy policy: https://uteamup.com/privacy.

## Review note for Athom

> UteamUP is a maintenance management (CMMS) service; this is UteamUP's official app. Pair the
> "UteamUP company" device with the demo API key and secret in this note, then watch the counts
> fill in. Try the "Report a problem" action: the quick report appears in the demo company. The
> demo key's role allows every card. Live events are optional and need the Enterprise plan; the
> demo company has it.

Give Athom a key for a **demo tenant**, never a customer tenant, with a role limited to the
permissions in the README, and revoke it after the review.

## Steps

1. **(you)** Sign in at https://tools.developer.homey.app with the UteamUP Athom account (create one
   with a company e-mail if needed). Use the developer name *UteamUP*.
2. **(you)** Webhooks → New webhook. Put its ID and secret in `env.json` (copy `env.json.example`).
   Never commit `env.json`.
3. **(you)** Create the GitHub repository `UteamUP/homey-uteamup` and push this repo.
4. **(you)** `npx homey login`, then on a Homey Pro on your network `npx homey app run` and pair a
   demo company: check the values, one action and one trigger.
5. `npx homey app validate --level publish` must pass (it does at the time of writing).
6. **(you)** `npx homey app publish`. It uploads a draft version.
7. **(you)** In Developer Tools → Apps → UteamUP, publish the draft to **Test** first and try the
   test link, then **Submit for certification**. Paste the review note and the demo key there.
8. Review can take up to two weeks. Apply Athom's feedback in this repo, bump the version in
   `.homeycompose/app.json` and add a line to `.homeychangelog.json`, then publish again.

## Later: Homey Cloud

Buy the Homey Verified Developer subscription (about €99 a year, companies only), switch the
`platforms` arrays as described in `README.md`, run `homey app validate --level verified`, test on a
Cloud Homey and submit a new version.
