/**
 * @name BondRank
 * @author Personal
 * @version 2.2.0
 * @description Discord 1대1 DM 헤더에 로컬 전용 인연 Rank 배지를 표시합니다.
 */

module.exports = class BondRank {
    constructor() {
        this.pluginName = "BondRank";
        this.version = "2.2.0";
        this.styleId = "bond-rank-style";
        this.headerBadgeClass = "bond-rank-header-badge";
        this.headerWrapSelector = '[data-bond-rank-header-wrap="true"]';
        this.headerBadgeSelector = '[data-bond-rank-header-badge="true"]';

        this.defaultSettings = {
            showHeaderBadge: true,
            showHeaderExpBar: true,
            excludeGroupDms: true,
            debugMode: false
        };

        this.settingsLabels = {
            showHeaderBadge: "Show badge in DM header",
            showHeaderExpBar: "Show EXP bar in DM header",
            excludeGroupDms: "Exclude group DMs",
            debugMode: "Debug Mode"
        };

        this.data = {};
        this.settings = {...this.defaultSettings};
        this.observer = null;
        this.renderTimer = null;
        this.retryTimers = [];
    }

    start() {
        console.log("[BondRank] started v2.2.0");
        this.loadSettings();
        this.loadData();
        this.injectStyles();
        this.renderHeaderBadge();

        [300, 700, 1500, 3000, 5000].forEach((delay) => {
            const timer = setTimeout(() => this.scheduleRender(), delay);
            this.retryTimers.push(timer);
        });

        this.startObserver();
    }

    stop() {
        this.stopObserver();

        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }

        this.retryTimers.forEach((timer) => clearTimeout(timer));
        this.retryTimers = [];
        this.removeHeaderBadge();
        document.getElementById(this.styleId)?.remove();
    }

    loadData() {
        try {
            const stored = BdApi.Data.load(this.pluginName, "bondData");
            this.data = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
        } catch (error) {
            this.data = {};
            console.warn("[BondRank] failed to load data", error);
        }

        return this.data;
    }

    saveData() {
        try {
            BdApi.Data.save(this.pluginName, "bondData", this.data);
        } catch (error) {
            console.warn("[BondRank] failed to save data", error);
        }
    }

    loadSettings() {
        try {
            const stored = BdApi.Data.load(this.pluginName, "settings");
            const safeStored = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};

            this.settings = {
                showHeaderBadge: safeStored.showHeaderBadge ?? this.defaultSettings.showHeaderBadge,
                showHeaderExpBar: safeStored.showHeaderExpBar ?? this.defaultSettings.showHeaderExpBar,
                excludeGroupDms: safeStored.excludeGroupDms ?? this.defaultSettings.excludeGroupDms,
                debugMode: safeStored.debugMode ?? this.defaultSettings.debugMode
            };
        } catch (error) {
            this.settings = {...this.defaultSettings};
            console.warn("[BondRank] failed to load settings", error);
        }

        return this.settings;
    }

    saveSettings() {
        try {
            BdApi.Data.save(this.pluginName, "settings", this.settings);
        } catch (error) {
            console.warn("[BondRank] failed to save settings", error);
        }
    }

    getBondRank(exp) {
        const bondExp = Math.max(0, Number(exp) || 0);
        return Math.max(1, Math.floor(Math.sqrt(bondExp / 100)) + 1);
    }

    getBondProgress(exp) {
        const bondExp = Math.max(0, Number(exp) || 0);
        const rank = this.getBondRank(bondExp);
        const currentRankStartExp = Math.max(0, Math.pow(rank - 1, 2) * 100);
        const nextRankExp = Math.pow(rank, 2) * 100;
        const rankRangeExp = Math.max(1, nextRankExp - currentRankStartExp);
        const progress = Math.min(1, Math.max(0, (bondExp - currentRankStartExp) / rankRangeExp));
        const progressPercent = Math.round(progress * 100);
        const remainingExp = Math.max(0, nextRankExp - bondExp);

        return {
            rank,
            bondExp,
            currentRankStartExp,
            nextRankExp,
            progress,
            progressPercent,
            remainingExp
        };
    }

    getCurrentChannelId() {
        const match = window.location.pathname.match(/\/channels\/@me\/(\d{5,})/);
        return match ? match[1] : null;
    }

    getChannelById(channelId) {
        if (!channelId) return null;

        try {
            const channelStore = BdApi.Webpack?.getStore?.("ChannelStore")
                || BdApi.findModuleByProps?.("getChannel", "getDMFromUserId");
            return channelStore?.getChannel?.(channelId) || null;
        } catch (error) {
            this.debug("[BondRank][Header] skip reason", "ChannelStore lookup failed", error);
            return null;
        }
    }

    isGroupDmByChannel(channel) {
        if (!channel) return false;
        return channel.type === 3 || channel.type === "GROUP_DM";
    }

    hasGroupDmText(text) {
        if (!text) return false;
        return /멤버\s*[2-9]\d*\s*명/i.test(text)
            || /\bmembers?\b/i.test(text);
    }

    renderHeaderBadge() {
        if (this.isSettingsOrModalOpen()) {
            this.removeHeaderBadge();
            this.debug("[BondRank][Header] skip reason", "settings/modal open");
            return;
        }

        if (!this.settings.showHeaderBadge) {
            this.removeHeaderBadge();
            this.debug("[BondRank][Header] skip reason", "disabled");
            return;
        }

        const channelId = this.getCurrentChannelId();
        this.debug("[BondRank][Header] channelId", channelId);

        if (!channelId) {
            this.removeHeaderBadge();
            this.debug("[BondRank][Header] skip reason", "not a DM channel");
            return;
        }

        const channel = this.getChannelById(channelId);
        const header = this.findHeaderElement();
        const headerText = this.getHeaderText(header);
        const isGroupDm = this.settings.excludeGroupDms
            && (this.isGroupDmByChannel(channel) || this.hasGroupDmText(headerText));

        this.debug("[BondRank][Header] channel.type", channel?.type);
        this.debug("[BondRank][Header] isGroupDm", isGroupDm);

        if (isGroupDm) {
            this.removeHeaderBadge();
            this.debug("[BondRank][Header] skip reason", "group DM");
            return;
        }

        if (!header) {
            this.removeHeaderBadge();
            this.debug("[BondRank][Header] skip reason", "header not found");
            return;
        }

        const target = this.findHeaderNameElement(header) || header;
        const displayName = this.getDisplayName(target, header);
        const entry = this.getOrCreateEntry(channelId, channel, displayName);
        const progress = this.getBondProgress(entry.bondExp);
        let wrapper = document.querySelector(this.headerWrapSelector);

        this.debug("[BondRank][Header] displayName", displayName);
        this.debug("[BondRank][Header] key", entry.key);
        this.debug("[BondRank][Header] exp", progress.bondExp);
        this.debug("[BondRank][Header] rank", progress.rank);
        this.debug("[BondRank][Header] nextRankExp", progress.nextRankExp);
        this.debug("[BondRank][Header] progressPercent", progress.progressPercent);
        this.debug("[BondRank][Header] remainingExp", progress.remainingExp);

        this.removeLegacyHeaderBadges();

        if (wrapper) {
            this.updateHeaderWrap(wrapper, progress);
            if (!target.parentElement?.contains(wrapper)) target.insertAdjacentElement("afterend", wrapper);
            this.debug("[BondRank][Header] updated");
            return;
        }

        wrapper = this.createHeaderWrap(channelId, progress);
        target.insertAdjacentElement("afterend", wrapper);
        this.debug("[BondRank][Header] inserted");
    }

    removeHeaderBadge() {
        document.querySelectorAll(`${this.headerWrapSelector}, ${this.headerBadgeSelector}`).forEach((element) => {
            element.remove();
            this.debug("[BondRank][Header] removed");
        });
    }

    removeLegacyHeaderBadges() {
        document.querySelectorAll(this.headerBadgeSelector).forEach((badge) => {
            if (!badge.closest(this.headerWrapSelector)) badge.remove();
        });
    }

    createHeaderWrap(channelId, progress) {
        const wrapper = document.createElement("span");
        wrapper.className = "bond-rank-header-wrap";
        wrapper.dataset.bondRankHeaderWrap = "true";
        wrapper.dataset.bondRankChannelId = channelId;

        const badge = document.createElement("span");
        badge.className = this.headerBadgeClass;
        badge.dataset.bondRankHeaderBadge = "true";

        const expWrap = document.createElement("span");
        expWrap.className = "bond-rank-exp-wrap";

        const bar = document.createElement("span");
        bar.className = "bond-rank-exp-bar";

        const fill = document.createElement("span");
        fill.className = "bond-rank-exp-fill";

        const text = document.createElement("span");
        text.className = "bond-rank-exp-text";

        bar.appendChild(fill);
        expWrap.append(bar, text);
        wrapper.append(badge, expWrap);
        this.updateHeaderWrap(wrapper, progress);

        return wrapper;
    }

    updateHeaderWrap(wrapper, progress) {
        const badge = wrapper.querySelector(`.${this.headerBadgeClass}`);
        const expWrap = wrapper.querySelector(".bond-rank-exp-wrap");
        const fill = wrapper.querySelector(".bond-rank-exp-fill");
        const text = wrapper.querySelector(".bond-rank-exp-text");

        if (badge) badge.textContent = `인연 Rank ${progress.rank}`;

        if (expWrap) expWrap.style.display = this.settings.showHeaderExpBar ? "inline-flex" : "none";
        if (fill) fill.style.width = `${progress.progressPercent}%`;
        if (text) text.textContent = `${progress.bondExp} / ${progress.nextRankExp} EXP`;
    }

    scheduleRender() {
        if (this.renderTimer) clearTimeout(this.renderTimer);

        this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            this.renderHeaderBadge();
        }, 80);
    }

    startObserver() {
        this.stopObserver();
        this.observer = new MutationObserver((mutations) => {
            if (mutations.length && mutations.every((mutation) => this.isOwnMutation(mutation))) return;
            this.scheduleRender();
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "aria-label", "href"]
        });
    }

    stopObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    getSettingsPanel() {
        this.loadSettings();

        const panel = document.createElement("div");
        panel.className = "bond-rank-settings";
        panel.setAttribute("aria-label", "BondRank Settings");

        Object.entries(this.settingsLabels).forEach(([key, label]) => {
            const row = document.createElement("label");
            row.className = "bond-rank-setting-row";

            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = Boolean(this.settings[key]);
            input.addEventListener("change", () => {
                this.settings[key] = input.checked;
                this.saveSettings();
                this.scheduleRender();
            });

            const text = document.createElement("span");
            text.textContent = label;

            row.append(input, text);
            panel.appendChild(row);
        });

        return panel;
    }

    injectStyles() {
        document.getElementById(this.styleId)?.remove();

        BdApi.DOM.addStyle(this.styleId, `
.bond-rank-header-wrap {
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
  margin-left: 8px !important;
  flex-shrink: 0 !important;
  max-width: 360px !important;
}

.bond-rank-header-badge {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 20px !important;
  padding: 0 8px !important;
  border-radius: 999px !important;
  font-size: 11px !important;
  font-weight: 800 !important;
  line-height: 20px !important;
  color: white !important;
  background: linear-gradient(90deg, #a855f7, #ec4899) !important;
  box-shadow: 0 0 10px rgba(236,72,153,.45) !important;
  white-space: nowrap !important;
  flex-shrink: 0 !important;
}

.bond-rank-exp-wrap {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  height: 20px !important;
  flex-shrink: 0 !important;
}

.bond-rank-exp-bar {
  position: relative !important;
  width: 120px !important;
  height: 7px !important;
  border-radius: 999px !important;
  overflow: hidden !important;
  background: rgba(120, 120, 140, 0.28) !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08) !important;
}

.bond-rank-exp-fill {
  position: absolute !important;
  left: 0 !important;
  top: 0 !important;
  height: 100% !important;
  width: 0% !important;
  border-radius: 999px !important;
  background: linear-gradient(90deg, #60a5fa, #a855f7, #ec4899) !important;
  transition: width 0.25s ease !important;
}

.bond-rank-exp-text {
  font-size: 11px !important;
  font-weight: 700 !important;
  color: rgba(255,255,255,0.82) !important;
  white-space: nowrap !important;
}

.bond-rank-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0;
}

.bond-rank-setting-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-normal);
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.bond-rank-setting-row input {
  cursor: pointer;
}
        `);
    }

    findHeaderElement() {
        return document.querySelector('section[aria-label*="Channel header" i]')
            || document.querySelector('section[aria-label*="채널" i]')
            || document.querySelector('[class*="chat"] [class*="title"]')
            || document.querySelector('main header')
            || document.querySelector('header');
    }

    findHeaderNameElement(header) {
        if (!header) return null;

        const selectors = [
            "h1",
            "header h1",
            '[class*="title"]',
            '[class*="name"]',
            "strong",
            "b",
            '[style*="font-weight: 700"]',
            '[style*="font-weight:700"]',
            '[style*="font-weight: 600"]',
            '[style*="font-weight:600"]'
        ];

        for (const selector of selectors) {
            const elements = header.querySelectorAll(selector);
            for (const element of elements) {
                if (element === header) continue;
                if (element.matches?.(this.headerBadgeSelector)) continue;
                if (element.querySelector?.(this.headerBadgeSelector)) continue;
                if (this.isReasonableNameElement(element)) return element;
            }
        }

        return null;
    }

    isReasonableNameElement(element) {
        const text = (element?.textContent || "").trim();
        if (!text) return false;
        if (this.hasGroupDmText(text)) return false;
        if (text.length > 80) return false;

        const rect = element.getBoundingClientRect?.();
        if (rect && (rect.width <= 0 || rect.height <= 0)) return false;

        return true;
    }

    getHeaderText(header = this.findHeaderElement()) {
        return [
            header?.innerText || "",
            header?.parentElement?.innerText || ""
        ].join("\n");
    }

    getDisplayName(target, header) {
        const raw = (target?.textContent || header?.querySelector("h1")?.textContent || "").trim();
        const cleaned = raw
            .replace(/인연\s+Rank\s+\d+/g, "")
            .replace(/\d+\s*\/\s*\d+\s*EXP/g, "")
            .trim();
        return cleaned || "Unknown";
    }

    getOrCreateEntry(channelId, channel, displayName) {
        const userId = this.getUserIdFromChannel(channel);
        const key = userId || `channel:${channelId}`;
        const legacyChannelKey = `channel:${channelId}`;
        let entry = this.data[key] || this.data[legacyChannelKey];
        let shouldSave = false;

        if (!entry || typeof entry !== "object") {
            entry = {
                userId: userId || null,
                channelId,
                displayName: displayName || "Unknown",
                bondExp: 0,
                bondRank: 1,
                lastUpdatedAt: new Date().toISOString()
            };
            this.data[key] = entry;
            shouldSave = true;
        }

        entry.userId = entry.userId || userId || null;
        entry.channelId = entry.channelId || channelId;
        entry.displayName = entry.displayName || displayName || "Unknown";
        entry.bondExp = Math.max(0, Number(entry.bondExp) || 0);
        const nextBondRank = this.getBondRank(entry.bondExp);
        if (entry.bondRank !== nextBondRank) {
            entry.bondRank = nextBondRank;
            shouldSave = true;
        }
        entry.lastUpdatedAt = entry.lastUpdatedAt || new Date().toISOString();

        if (this.data[key] !== entry) {
            this.data[key] = entry;
            shouldSave = true;
        }

        if (shouldSave) this.saveData();

        return {
            ...entry,
            key
        };
    }

    getUserIdFromChannel(channel) {
        if (!channel) return null;

        const possibleIds = [
            channel.recipientId,
            channel.recipient_id,
            channel.rawRecipients?.[0]?.id,
            channel.recipients?.[0]?.id,
            Array.isArray(channel.recipientIds) ? channel.recipientIds[0] : null,
            channel.getRecipientId?.()
        ];

        const id = possibleIds.find((value) => /^\d+$/.test(String(value || "")));
        return id ? String(id) : null;
    }

    isSettingsOrModalOpen() {
        if (document.querySelector('[role="dialog"]')) return true;
        if (document.querySelector('[class*="layer"] [class*="standardSidebarView"]')) return true;
        if (document.querySelector('[class*="standardSidebarView"]')) return true;
        if (document.querySelector(".bond-rank-settings")) return true;
        if ((document.body?.textContent || "").includes("BondRank Settings")) return true;
        return /\/settings(?:\/|$)/i.test(window.location.pathname);
    }

    isOwnMutation(mutation) {
        const target = mutation.target?.nodeType === Node.ELEMENT_NODE ? mutation.target : null;
        if (target?.matches?.(this.headerWrapSelector) || target?.closest?.(this.headerWrapSelector)) return true;
        if (target?.matches?.(this.headerBadgeSelector) || target?.closest?.(this.headerBadgeSelector)) return true;

        const nodes = [...mutation.addedNodes, ...mutation.removedNodes]
            .filter((node) => node.nodeType === Node.ELEMENT_NODE);

        if (!nodes.length) return false;
        return nodes.every((node) => {
            return node.matches?.(this.headerWrapSelector)
                || node.querySelector?.(this.headerWrapSelector)
                || node.matches?.(this.headerBadgeSelector)
                || node.querySelector?.(this.headerBadgeSelector);
        });
    }

    debug(...args) {
        if (this.settings.debugMode) console.log(...args);
    }
};
