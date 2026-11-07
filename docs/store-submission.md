# Homey App Store submission — UteamUP

Submission details for the UteamUP Athom account. Homey 0.1.1 includes the signed-event security
fix in 101ffcc and addresses the three certification issues reported on 2026-10-26.

## Listing

| Field | English |
|-------|---------|
| App ID | `com.uteamup` |
| Name | UteamUP |
| Description (one line) | Keep maintenance work in step with your home and building |
| Category | Tools |
| Brand color | `#206BB5` (UteamUP blue, the cube's right face) |
| Readme | `README.txt` |
| Tags | maintenance, work order, cmms, facility, building, alerts, meter |
| Homepage | https://uteamup.com |
| Support | mailto:support@uteamup.com |
| Source | https://github.com/UteamUP/homey-uteamup |
| Issues | https://github.com/UteamUP/homey-uteamup/issues |
| Platforms | Homey Pro (`local`); Cloud-ready, not enabled |
| Permissions | none |
| Price | free (connects to a paid UteamUP plan, which the guidelines allow) |

Athom requested removal of Icelandic for certification. The published manifest, Flow cards,
pairing text and store readme therefore use English. The API secret label is `API secret`;
credential values are never used as UI labels.

Check `support@uteamup.com` is a monitored address before submitting.

## Images and icons (in the repo)

| Asset | File | Size |
|-------|------|------|
| App image small / large / xlarge | `assets/images/small.png`, `large.png`, `xlarge.png` | 250×175, 500×350, 1000×700 |
| Driver image small / large / xlarge | `drivers/company/assets/images/…` | 75×75, 500×500, 1000×1000 on white |
| App icon | `assets/icon.svg` | 960×960, transparent, the cube |
| Driver icon | `drivers/company/assets/icon.svg` | 960×960, transparent, a work order clipboard |

The app image is a licensed photograph of heating-system maintenance, replacing the rejected
generic illustration. Source, photographer and Pexels License are recorded in
`docs/image-sources/app-photo-license.txt`. It contains no Homey device or logo and makes no
endorsement claim. The driver artwork remains separate, with `docs/image-sources/driver.svg`
as its source.

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

Read back on 2026-11-07: 0.1.0 (build 1) was rejected on 2026-10-26 for unsupported Icelandic,
an incorrect API-secret label and generic app artwork. There is no Live version. The 0.1.1
submission corrects those issues and retains the signed-event security fix. The Test link is
https://homey.app/a/com.uteamup/test/. Certification and public availability must be verified
separately after upload; automatic publication is requested on approval.

1. Done. The Athom account is gisli@uteamup.com (Google sign-in); it may publish for Homey Pro.
2. Done. Webhook `6adb59b9a2ce176b47a51a6b` (query-parameter matching) in Developer Tools →
   My Webhooks. Its ID and secret are in the local `env.json`, which is never committed.
3. Done. https://github.com/UteamUP/homey-uteamup (public, like `ha-uteamup`); CI is green.
4. `npx homey login` is done. No Homey is linked to the account, so `homey app run` on a device has
   not been possible; Athom tests the app during certification.
5. `npx homey app validate --level publish` passes.
6. Done. `HOMEY_HEADLESS=1 npx homey app publish` uploaded build 1 and it was published to Test.
7. Done. Submitted for certification in Developer Tools → Apps → com.uteamup → Build 1. Give Athom a
   demo-tenant API key by e-mail from support@uteamup.com if they ask for one.
8. Review can take up to two weeks. Apply Athom's feedback in this repo, bump the version in
   `.homeycompose/app.json` and add a line to `.homeychangelog.json`, then publish again.

## Later: Homey Cloud

Buy the Homey Verified Developer subscription (about €99 a year, companies only), switch the
`platforms` arrays as described in `README.md`, run `homey app validate --level verified`, test on a
Cloud Homey and submit a new version.
