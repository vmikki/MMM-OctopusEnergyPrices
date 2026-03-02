const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({
	start () {
		Log.info(`[${this.name}] node_helper started`);
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "MMM_OCTOPUS_ENERGY_PRICES_FETCH") {
			return;
		}

		Log.info(`[${this.name}] price fetch requested`);
		this.handlePriceRequest(payload);
	},

	async handlePriceRequest (payload) {
		const runtimePayload = this.withEnvFallback(payload);
		const instanceId = runtimePayload?.instanceId;

		try {
			this.validatePayload(runtimePayload);
			const data = await this.fetchOctopusPrices(runtimePayload);

			this.sendSocketNotification("MMM_OCTOPUS_ENERGY_PRICES_DATA", {
				instanceId,
				...data
			});
			Log.info(`[${this.name}] fetched ${data.slots.length} price slots for tariff ${data.tariffCode}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			Log.error(`[${this.name}] ${message}`);
			this.sendSocketNotification("MMM_OCTOPUS_ENERGY_PRICES_ERROR", {
				instanceId,
				error: message
			});
		}
	},

	withEnvFallback (payload) {
		const source = payload || {};
		return {
			...source,
			accountNumber: source.accountNumber || process.env.OCTOPUS_ACCOUNT_NUMBER || "",
			apiKey: source.apiKey || process.env.OCTOPUS_API_KEY || "",
			tariffCode: source.tariffCode || process.env.OCTOPUS_TARIFF_CODE || "",
			productCode: source.productCode || process.env.OCTOPUS_PRODUCT_CODE || ""
		};
	},

	validatePayload (payload) {
		if (!payload) {
			throw new Error("Invalid request payload.");
		}

		const hasAccountCredentials = Boolean(payload.accountNumber && payload.apiKey);
		const hasTariff = Boolean(payload.tariffCode);

		if (!hasAccountCredentials && !hasTariff) {
			throw new Error("Set either (accountNumber + apiKey) or tariffCode in the module config.");
		}
	},

	async fetchOctopusPrices (payload) {
		const now = new Date();
		const includePastHours = Number(payload.includePastHours) || 0;
		const hoursToShow = Number(payload.hoursToShow) || 24;
		const timeoutMs = Number(payload.requestTimeout) || 12000;
		const fetchLeadMs = 30 * 60 * 1000;
		const periodFrom = new Date(now.getTime() - includePastHours * 60 * 60 * 1000 - fetchLeadMs).toISOString();
		const periodTo = new Date(now.getTime() + hoursToShow * 60 * 60 * 1000).toISOString();

		let tariffCode = payload.tariffCode || "";
		let productCode = payload.productCode || "";
		let source = "tariff";

		if (!tariffCode && payload.accountNumber && payload.apiKey) {
			const activeAgreement = await this.fetchActiveTariffFromAccount(payload.accountNumber, payload.apiKey, timeoutMs);
			tariffCode = activeAgreement.tariffCode;
			productCode = productCode || this.extractProductCode(tariffCode);
			source = "account";
		}

		if (!tariffCode) {
			throw new Error("Unable to resolve tariff code.");
		}

		if (!productCode) {
			productCode = this.extractProductCode(tariffCode);
		}

		if (!productCode) {
			throw new Error("Unable to resolve product code. Set productCode explicitly in config.");
		}

		const slots = await this.fetchUnitRates({
			apiKey: payload.apiKey,
			productCode,
			tariffCode,
			periodFrom,
			periodTo,
			timeoutMs
		});

		if (slots.length === 0) {
			throw new Error("No price slots returned from Octopus API for the requested window.");
		}

		return {
			source,
			productCode,
			tariffCode,
			fetchedAt: new Date().toISOString(),
			slots
		};
	},

	async fetchActiveTariffFromAccount (accountNumber, apiKey, timeoutMs) {
		const accountUrl = `https://api.octopus.energy/v1/accounts/${encodeURIComponent(accountNumber)}/`;
		const accountData = await this.fetchJson(accountUrl, {
			headers: this.createAuthHeaders(apiKey),
			timeoutMs
		});

		const agreements = [];
		const properties = Array.isArray(accountData?.properties) ? accountData.properties : [];

		properties.forEach((property) => {
			const meterPoints = Array.isArray(property.electricity_meter_points) ? property.electricity_meter_points : [];
			meterPoints.forEach((meterPoint) => {
				const meterPointAgreements = Array.isArray(meterPoint.agreements) ? meterPoint.agreements : [];
				meterPointAgreements.forEach((agreement) => {
					if (agreement?.tariff_code) {
						agreements.push({
							tariffCode: agreement.tariff_code,
							validFrom: agreement.valid_from,
							validTo: agreement.valid_to || null
						});
					}
				});
			});
		});

		if (agreements.length === 0) {
			throw new Error("No electricity agreements found on the Octopus account.");
		}

		const nowMs = Date.now();
		const activeAgreements = agreements.filter((agreement) => {
			const start = Date.parse(agreement.validFrom);
			const end = agreement.validTo ? Date.parse(agreement.validTo) : Number.POSITIVE_INFINITY;
			return Number.isFinite(start) && nowMs >= start && nowMs < end;
		});

		if (activeAgreements.length > 0) {
			activeAgreements.sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
			return activeAgreements[0];
		}

		agreements.sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
		return agreements[0];
	},

	async fetchUnitRates ({ apiKey, productCode, tariffCode, periodFrom, periodTo, timeoutMs }) {
		const baseUrl = `https://api.octopus.energy/v1/products/${encodeURIComponent(productCode)}/electricity-tariffs/${encodeURIComponent(tariffCode)}/standard-unit-rates/`;
		const params = new URLSearchParams({
			period_from: periodFrom,
			period_to: periodTo,
			page_size: "250"
		});

		let url = `${baseUrl}?${params.toString()}`;
		const headers = apiKey ? this.createAuthHeaders(apiKey) : {};
		const allResults = [];
		let pageCounter = 0;

		while (url) {
			pageCounter += 1;
			if (pageCounter > 12) {
				break;
			}

			const page = await this.fetchJson(url, {
				headers,
				timeoutMs
			});

			if (Array.isArray(page?.results)) {
				allResults.push(...page.results);
			}

			url = page?.next || null;
		}

		return allResults
			.filter((entry) => entry?.valid_from && entry?.valid_to)
			.map((entry) => ({
				start: entry.valid_from,
				end: entry.valid_to,
				valueIncVat: Number(entry.value_inc_vat),
				valueExcVat: Number(entry.value_exc_vat)
			}))
			.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
	},

	extractProductCode (tariffCode) {
		if (!tariffCode || typeof tariffCode !== "string") {
			return "";
		}

		const parts = tariffCode.split("-");
		if (parts.length < 5) {
			return "";
		}

		return parts.slice(2, -1).join("-");
	},

	createAuthHeaders (apiKey) {
		const token = Buffer.from(`${apiKey}:`).toString("base64");
		return {
			Authorization: `Basic ${token}`
		};
	},

	async fetchJson (url, options) {
		const controller = new AbortController();
		const timeoutMs = Number(options?.timeoutMs) || 12000;
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: options?.headers || {},
				signal: controller.signal
			});

			if (!response.ok) {
				const bodySnippet = (await response.text()).slice(0, 180).replace(/\s+/g, " ").trim();
				throw new Error(`Octopus API HTTP ${response.status}: ${bodySnippet}`);
			}

			return await response.json();
		} catch (error) {
			if (error?.name === "AbortError") {
				throw new Error(`Octopus API request timed out after ${timeoutMs}ms.`);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}
});
