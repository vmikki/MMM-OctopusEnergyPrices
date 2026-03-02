/* global Module, Log, config */

Module.register("MMM-OctopusEnergyPrices", {
	defaults: {
		updateInterval: 10 * 60 * 1000,
		initialLoadDelay: 0,
		animationSpeed: 600,
		hoursToShow: 24,
		includePastHours: 2,
		includeVat: true,
		priceUnit: "p/kWh",
		roundToPenny: false,
		decimalPlaces: 2,
		timeFormat: config.timeFormat,
		locale: "en-GB",
		timezone: "Europe/London",
		graphWidth: 460,
		graphHeight: 210,
		apiKey: "",
		accountNumber: "",
		tariffCode: "",
		productCode: "",
		requestTimeout: 12000
	},

	getStyles () {
		return ["MMM-OctopusEnergyPrices.css"];
	},

	start () {
		Log.info(`Starting module: ${this.name}`);

		this.loaded = false;
		this.error = null;
		this.priceSlots = [];
		this.fetchedAt = null;
		this.resolvedTariffCode = this.config.tariffCode || null;
		this.resolvedProductCode = this.config.productCode || null;
		this.updateTimer = null;
		this.timeFormatter = this.createTimeFormatter();

		this.scheduleUpdate(this.config.initialLoadDelay);
	},

	suspend () {
		clearTimeout(this.updateTimer);
	},

	resume () {
		this.scheduleUpdate(0);
	},

	createTimeFormatter () {
		const formatterOptions = {
			hour: "2-digit",
			minute: "2-digit",
			hour12: this.config.timeFormat === 12
		};

		if (this.config.timezone) {
			formatterOptions.timeZone = this.config.timezone;
		}

		return new Intl.DateTimeFormat(this.config.locale || "en-GB", formatterOptions);
	},

	scheduleUpdate (delay) {
		const nextLoad = typeof delay === "number" ? Math.max(0, delay) : this.config.updateInterval;
		clearTimeout(this.updateTimer);

		this.updateTimer = setTimeout(() => {
			this.fetchPriceData();
			this.scheduleUpdate(this.config.updateInterval);
		}, nextLoad);
	},

	fetchPriceData () {
		this.sendSocketNotification("MMM_OCTOPUS_ENERGY_PRICES_FETCH", {
			instanceId: this.identifier,
			apiKey: this.config.apiKey,
			accountNumber: this.config.accountNumber,
			tariffCode: this.config.tariffCode,
			productCode: this.config.productCode,
			hoursToShow: this.config.hoursToShow,
			includePastHours: this.config.includePastHours,
			requestTimeout: this.config.requestTimeout
		});
	},

	socketNotificationReceived (notification, payload) {
		if (!payload || payload.instanceId !== this.identifier) {
			return;
		}

		if (notification === "MMM_OCTOPUS_ENERGY_PRICES_DATA") {
			this.loaded = true;
			this.error = null;
			this.priceSlots = Array.isArray(payload.slots) ? payload.slots : [];
			this.fetchedAt = payload.fetchedAt || null;
			this.resolvedTariffCode = payload.tariffCode || this.resolvedTariffCode;
			this.resolvedProductCode = payload.productCode || this.resolvedProductCode;
			this.updateDom(this.config.animationSpeed);
		}

		if (notification === "MMM_OCTOPUS_ENERGY_PRICES_ERROR") {
			this.loaded = true;
			this.error = payload.error || "Unable to load Octopus price data.";
			this.updateDom(this.config.animationSpeed);
		}
	},

	getDom () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-octopus-energy-prices";

		if (!this.loaded) {
			wrapper.classList.add("dimmed", "light", "small");
			wrapper.innerText = "Loading Octopus electricity prices...";
			return wrapper;
		}

		if (this.error) {
			wrapper.classList.add("small");
			const errorTitle = document.createElement("div");
			errorTitle.className = "oep-error-title";
			errorTitle.innerText = "Octopus prices unavailable";
			wrapper.appendChild(errorTitle);

			const errorText = document.createElement("div");
			errorText.className = "oep-error-text";
			errorText.innerText = this.error;
			wrapper.appendChild(errorText);
			return wrapper;
		}

		const displaySlots = this.getDisplaySlots();
		if (displaySlots.length === 0) {
			wrapper.classList.add("small");
			wrapper.innerText = "No Octopus price slots were returned for the selected window.";
			return wrapper;
		}

		wrapper.appendChild(this.getSummaryElement(displaySlots));
		wrapper.appendChild(this.getGraphElement(displaySlots));
		wrapper.appendChild(this.getFooterElement(displaySlots));
		return wrapper;
	},

	getDisplaySlots () {
		const now = Date.now();
		const periodFrom = now - this.config.includePastHours * 60 * 60 * 1000;
		const periodTo = now + this.config.hoursToShow * 60 * 60 * 1000;

		return this.priceSlots
			.filter((slot) => slot && slot.start && slot.end)
			.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
			.filter((slot) => {
				const slotStart = Date.parse(slot.start);
				const slotEnd = Date.parse(slot.end);
				return Number.isFinite(slotStart) && Number.isFinite(slotEnd) && slotEnd >= periodFrom && slotStart <= periodTo;
			});
	},

	getSummaryElement (slots) {
		const summary = document.createElement("div");
		summary.className = "oep-summary";

		const currentSlot = this.findCurrentSlot(slots);
		const nextSlot = this.findNextSlot(slots);
		const values = slots.map((slot) => this.getSlotValue(slot));
		const minValue = Math.min(...values);
		const maxValue = Math.max(...values);
		const avgValue = values.reduce((sum, value) => sum + value, 0) / values.length;
		const minSlot = slots.find((slot) => this.getSlotValue(slot) === minValue);
		const maxSlot = slots.find((slot) => this.getSlotValue(slot) === maxValue);

		const primaryRow = document.createElement("div");
		primaryRow.className = "oep-primary-row";
		const primaryLabel = document.createElement("span");
		primaryLabel.className = "oep-label";
		const primaryValue = document.createElement("span");
		primaryValue.className = "oep-value";

		if (currentSlot) {
			primaryLabel.innerText = "Now";
			primaryValue.innerText = this.formatPrice(this.getSlotValue(currentSlot));
		} else {
			primaryLabel.innerText = "Current";
			primaryValue.innerText = "n/a";
		}

		primaryRow.appendChild(primaryLabel);
		primaryRow.appendChild(primaryValue);
		summary.appendChild(primaryRow);

		const metaRow = document.createElement("div");
		metaRow.className = "oep-meta-row";
		const pieces = [];

		if (nextSlot) {
			pieces.push(`Next ${this.formatTime(nextSlot.start)}: ${this.formatPrice(this.getSlotValue(nextSlot))}`);
		}
		if (minSlot) {
			pieces.push(`Low ${this.formatPrice(minValue)} at ${this.formatTime(minSlot.start)}`);
		}
		if (maxSlot) {
			pieces.push(`High ${this.formatPrice(maxValue)} at ${this.formatTime(maxSlot.start)}`);
		}

		metaRow.innerText = pieces.join("  |  ");
		summary.appendChild(metaRow);

		const avgRow = document.createElement("div");
		avgRow.className = "oep-meta-row oep-average";
		avgRow.innerText = `${Math.round(this.config.hoursToShow)}h average: ${this.formatPrice(avgValue)}`;
		summary.appendChild(avgRow);

		return summary;
	},

	getGraphElement (slots) {
		const graphHost = document.createElement("div");
		graphHost.className = "oep-graph-host";

		const width = this.config.graphWidth;
		const height = this.config.graphHeight;
		const margin = { top: 12, right: 12, bottom: 28, left: 42 };
		const chartWidth = width - margin.left - margin.right;
		const chartHeight = height - margin.top - margin.bottom;
		const chartBottom = margin.top + chartHeight;
		const slotCount = slots.length;
		const step = slotCount > 1 ? chartWidth / (slotCount - 1) : 0;
		const values = slots.map((slot) => this.getSlotValue(slot));
		const minValue = Math.min(...values);
		let maxValue = Math.max(...values);

		if (maxValue === minValue) {
			maxValue = minValue + 0.1;
		}

		const toY = (value) => {
			const position = (value - minValue) / (maxValue - minValue);
			return chartBottom - position * chartHeight;
		};

		const svg = this.createSvgNode("svg", {
			viewBox: `0 0 ${width} ${height}`,
			preserveAspectRatio: "none",
			class: "oep-graph-svg",
			role: "img",
			"aria-label": "Octopus electricity unit price graph"
		});

		[0, 0.25, 0.5, 0.75, 1].forEach((fraction) => {
			const y = margin.top + fraction * chartHeight;
			svg.appendChild(this.createSvgNode("line", {
				x1: margin.left,
				y1: y,
				x2: margin.left + chartWidth,
				y2: y,
				class: "oep-grid-line"
			}));
		});

		const now = Date.now();
		const currentIndex = slots.findIndex((slot) => {
			const start = Date.parse(slot.start);
			const end = Date.parse(slot.end);
			return now >= start && now < end;
		});

		if (currentIndex >= 0) {
			const highlightWidth = slotCount > 1 ? Math.max(step, 6) : chartWidth;
			const centerX = margin.left + currentIndex * step;
			const left = slotCount > 1 ? centerX - highlightWidth / 2 : margin.left;
			svg.appendChild(this.createSvgNode("rect", {
				x: left,
				y: margin.top,
				width: highlightWidth,
				height: chartHeight,
				class: "oep-current-slot"
			}));
		}

		const barWidth = slotCount > 1 ? Math.max(2, step * 0.82) : chartWidth * 0.65;
		slots.forEach((slot, index) => {
			const value = this.getSlotValue(slot);
			const x = slotCount > 1 ? margin.left + index * step - barWidth / 2 : margin.left + (chartWidth - barWidth) / 2;
			const y = toY(value);
			const normalized = (value - minValue) / (maxValue - minValue);

			svg.appendChild(this.createSvgNode("rect", {
				x,
				y,
				width: barWidth,
				height: chartBottom - y,
				fill: this.getBarColor(normalized),
				class: "oep-rate-bar"
			}));
		});

		const linePoints = slots
			.map((slot, index) => {
				const x = slotCount > 1 ? margin.left + index * step : margin.left + chartWidth / 2;
				return `${x},${toY(this.getSlotValue(slot))}`;
			})
			.join(" ");
		svg.appendChild(this.createSvgNode("polyline", {
			points: linePoints,
			class: "oep-price-line"
		}));

		const labelCount = Math.min(3, slots.length);
		const labelIndexes = labelCount === 1 ? [0] : labelCount === 2 ? [0, slots.length - 1] : [0, Math.floor((slots.length - 1) / 2), slots.length - 1];
		labelIndexes.forEach((slotIndex) => {
			const x = slotCount > 1 ? margin.left + slotIndex * step : margin.left + chartWidth / 2;
			svg.appendChild(this.createSvgNode("text", {
				x,
				y: height - 6,
				class: "oep-axis-label"
			}, this.formatTime(slots[slotIndex].start)));
		});

		svg.appendChild(this.createSvgNode("text", {
			x: margin.left - 6,
			y: margin.top + 4,
			class: "oep-axis-label oep-axis-value"
		}, this.formatPrice(maxValue)));

		svg.appendChild(this.createSvgNode("text", {
			x: margin.left - 6,
			y: chartBottom,
			class: "oep-axis-label oep-axis-value"
		}, this.formatPrice(minValue)));

		graphHost.appendChild(svg);
		return graphHost;
	},

	getFooterElement () {
		const footer = document.createElement("div");
		footer.className = "oep-footer";

		const tariffText = this.resolvedTariffCode ? `Tariff ${this.resolvedTariffCode}` : "Tariff unavailable";
		const productText = this.resolvedProductCode ? `Product ${this.resolvedProductCode}` : "";
		const updatedText = this.fetchedAt ? `Updated ${this.formatTime(this.fetchedAt)}` : "Waiting for first update";

		footer.innerText = [tariffText, productText, updatedText].filter(Boolean).join("  |  ");
		return footer;
	},

	createSvgNode (name, attributes, textContent) {
		const element = document.createElementNS("http://www.w3.org/2000/svg", name);
		Object.keys(attributes).forEach((attribute) => {
			element.setAttribute(attribute, attributes[attribute]);
		});

		if (typeof textContent === "string") {
			element.textContent = textContent;
		}

		return element;
	},

	getBarColor (normalized) {
		const clamped = Math.max(0, Math.min(1, normalized));
		const hue = 125 - 125 * clamped;
		return `hsl(${hue}, 72%, 52%)`;
	},

	getSlotValue (slot) {
		return this.config.includeVat ? Number(slot.valueIncVat) : Number(slot.valueExcVat);
	},

	findCurrentSlot (slots) {
		const now = Date.now();
		return slots.find((slot) => now >= Date.parse(slot.start) && now < Date.parse(slot.end)) || null;
	},

	findNextSlot (slots) {
		const now = Date.now();
		return slots.find((slot) => Date.parse(slot.start) > now) || null;
	},

	formatPrice (value) {
		const numericValue = Number(value);
		if (!Number.isFinite(numericValue)) {
			return "n/a";
		}

		if (this.config.roundToPenny) {
			return `${Math.round(numericValue)} ${this.config.priceUnit}`;
		}

		return `${numericValue.toFixed(this.config.decimalPlaces)} ${this.config.priceUnit}`;
	},

	formatTime (isoString) {
		try {
			return this.timeFormatter.format(new Date(isoString));
		} catch (error) {
			return isoString;
		}
	}
});
