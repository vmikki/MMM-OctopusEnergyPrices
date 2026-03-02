# MMM-OctopusEnergyPrices

MagicMirror module for visualizing Octopus Energy electricity unit rates with a live graph.

> Disclaimer: This is an independent, community-built module and is **not** an official module, product, or service from Octopus Energy.

## Features

- Pulls real Octopus tariff prices from the official Octopus Energy API.
- Draws a price graph (bars + trend line) for current and upcoming time slots.
- Shows key stats: current price, next price, low/high slots, and rolling average.
- Supports two setup modes:
  - Account mode: use `accountNumber + apiKey` and auto-detect active electricity tariff.
  - Tariff mode: provide `tariffCode` (and optional `productCode`) without account lookup.

## Requirements

- MagicMirror² running on Node.js 18+.
- Octopus Energy account (for account mode).

## Installation

1. Open your MagicMirror modules directory:

```bash
cd ~/MagicMirror/modules
```

2. Clone this module:

```bash
git clone https://github.com/vmikki/MMM-OctopusEnergyPrices.git
```

3. Add it to `config/config.js`:

```js
{
	module: "MMM-OctopusEnergyPrices",
	position: "top_right",
	header: "Electricity Prices",
	config: {
		// Mode 1 (recommended): account mode
		accountNumber: "A-12345678",
		apiKey: "sk_live_xxxxxxx",

		// Optional overrides
		hoursToShow: 24,
		includePastHours: 2,
		includeVat: true,
		timezone: "Europe/London"
	}
}
```

4. Restart MagicMirror.

No extra `npm install` step is required for this module.

## What information you need

### Minimum info (account mode)

- `accountNumber` (for example `A-12345678`)
- `apiKey` (your Octopus API key)

With these two values, the module auto-resolves your active electricity tariff and product code.

### Where to get these values

- `accountNumber`:
  - Usually starts with `A-` and is shown in your Octopus account and bills/statements.
- `apiKey`:
  - Generate or copy it from your Octopus online account API/developer settings page.
  - Octopus API docs: <https://developer.octopus.energy/rest/guides/endpoints>
  - Test it quickly:

```bash
curl -u "YOUR_API_KEY:" "https://api.octopus.energy/v1/accounts/A-12345678/"
```

If that command returns your account JSON, your API key and account number are correct.

### Alternative info (tariff mode)

- `tariffCode` (for example `E-1R-AGILE-24-10-01-K`)
- Optional `productCode` (for example `AGILE-24-10-01`)

If `productCode` is omitted, the module attempts to derive it from `tariffCode`.

Example tariff-mode config:

```js
{
	module: "MMM-OctopusEnergyPrices",
	position: "top_right",
	config: {
		tariffCode: "E-1R-AGILE-24-10-01-K",
		productCode: "AGILE-24-10-01"
	}
}
```

## Getting account details from Octopus

- API docs: <https://developer.octopus.energy/rest/guides/endpoints>
- Account endpoint: `GET /v1/accounts/{account_number}/`
- Unit rates endpoint:
  `GET /v1/products/{product_code}/electricity-tariffs/{tariff_code}/standard-unit-rates/`

Useful lookup example (same as above):
`curl -u "YOUR_API_KEY:" "https://api.octopus.energy/v1/accounts/A-12345678/"`

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | `""` | Octopus API key. Required for account mode. |
| `accountNumber` | `string` | `""` | Octopus account number. Required for account mode. |
| `tariffCode` | `string` | `""` | Tariff code for direct tariff mode. |
| `productCode` | `string` | `""` | Product code. Optional if derivable from tariff code. |
| `updateInterval` | `number` | `600000` | Fetch interval in milliseconds. |
| `initialLoadDelay` | `number` | `0` | Delay before first fetch in milliseconds. |
| `hoursToShow` | `number` | `24` | Future hours to request and graph. |
| `includePastHours` | `number` | `2` | Past hours included in graph context. |
| `includeVat` | `boolean` | `true` | Use VAT-inclusive prices when true. |
| `priceUnit` | `string` | `"p/kWh"` | Price suffix displayed in UI. |
| `roundToPenny` | `boolean` | `false` | Round displayed prices to whole pence (`36 p/kWh`). |
| `decimalPlaces` | `number` | `2` | Price precision in UI. |
| `timezone` | `string` | `"Europe/London"` | Timezone for labels and summaries. |
| `locale` | `string` | `"en-GB"` | Locale used for time labels. |
| `timeFormat` | `number` | `config.timeFormat` | `12` or `24` hour labels. |
| `graphWidth` | `number` | `460` | Internal SVG width. |
| `graphHeight` | `number` | `210` | Internal SVG height. |
| `requestTimeout` | `number` | `12000` | API timeout in milliseconds. |
| `animationSpeed` | `number` | `600` | DOM update animation speed. |

When `roundToPenny` is `true`, `decimalPlaces` is ignored for display output.

## Troubleshooting

- `Set either (accountNumber + apiKey) or tariffCode...`
  - Add account credentials, or provide `tariffCode`.
- `Octopus API HTTP 401`
  - API key is invalid or missing permissions.
- `No price slots returned...`
  - Tariff/product combination may be wrong, or no data is available for the requested period.
- Time labels look wrong
  - Set `timezone` explicitly (usually `Europe/London`) and verify your Pi timezone.

## Security Notes

- Keep API keys out of public repos.
- If you commit `config.js`, prefer environment variables:

```js
apiKey: process.env.OCTOPUS_API_KEY
```

- Recommended for Raspberry Pi sync workflows:
  - Keep secrets in a machine-local env file (for example `.dashboard-secrets.env`) and do not commit it.

## License

MIT
