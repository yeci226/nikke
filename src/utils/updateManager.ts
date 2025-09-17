import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { Logger } from "../services/logger.js";

// ==================== 接口定義 ====================

export interface GitHubFile {
	name: string;
	path: string;
	download_url: string;
	size: number;
	type: string;
}

export interface UpdateConfig {
	name: string;
	type: "github" | "json" | "url-monitor" | "dynamic-json";
	enabled: boolean;
	checkInterval: number; // 毫秒
	// GitHub 配置
	githubRepo?: string;
	githubPath?: string;
	localPath?: string;
	// JSON 配置
	jsonSources?: string[];
	jsonOutputFile?: string;
	// URL 監控配置
	notebookUrl?: string;
	twUrlPattern?: string;
	enUrlPattern?: string;
	// 動態 JSON 配置
	dynamicUrlSource?: string; // notebook URL
	urlPattern?: string; // 用於提取 URL 的正則表達式
	// Commit 追蹤配置
	enableCommitTracking?: boolean; // 是否啟用 commit 追蹤
	commitStorageFile?: string; // commit hash 存儲文件路徑
	// 通用配置
	validateUrls?: boolean;
	deduplicate?: boolean;
	enableCommitCheck?: boolean;
	excludePatterns?: string[];
	fileExtensions?: string[];
}

export interface UpdateStatus {
	name: string;
	isRunning: boolean;
	lastCheck: Date | null;
	nextCheck: Date | null;
	lastUpdate: Date | null;
	status: "success" | "error" | "pending" | "disabled";
	error?: string;
	stats?: {
		localFiles?: number;
		remoteFiles?: number;
		missingFiles?: number;
	};
}

export interface TwUrlData {
	url: string;
	timestamp: number;
	source: string;
}

export interface UrlConfig {
	twUrl: string;
	enUrl: string;
}

export interface CommitInfo {
	commitHash: string;
	timestamp: number;
	url: string;
}

export interface GitHubCommit {
	sha: string;
	commit: {
		message: string;
		author: {
			name: string;
			email: string;
			date: string;
		};
	};
}

// ==================== 統一更新管理器 ====================

export class UpdateManager {
	private configs: Map<string, UpdateConfig> = new Map();
	private intervals: Map<string, NodeJS.Timeout> = new Map();
	private statuses: Map<string, UpdateStatus> = new Map();
	private lastCommitHashes: Map<string, string> = new Map();
	private lastKnownUrls: UrlConfig | null = null;
	private readonly logger = new Logger("更新管理器");

	constructor() {
		this.loadDefaultConfigs();
	}

	/**
	 * 加載默認配置
	 */
	private loadDefaultConfigs(): void {
		// Sprite 更新配置
		this.addConfig({
			name: "sprite",
			type: "github",
			enabled: true,
			checkInterval: 24 * 60 * 60 * 1000, // 24小時
			githubRepo: "Nikke-db/Nikke-db.github.io",
			githubPath: "images/sprite",
			localPath: "src/assets/images/sprite",
			excludePatterns: ["4koma", "4格", "四格", "comic"],
			fileExtensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"]
		});

		// Characters TW 更新配置 - 使用動態 URL 和 commit 追蹤
		this.addConfig({
			name: "characters-tw",
			type: "dynamic-json",
			enabled: true,
			checkInterval: 24 * 60 * 60 * 1000, // 24小時
			dynamicUrlSource:
				"https://raw.githubusercontent.com/IsolateOB/ExiaInvasion/main/exia-invasion/src/api.js",
			urlPattern: "NIKKE_TW_URL\\s*=\\s*['\"`]([^'\"`]+)['\"`]",
			jsonOutputFile: "src/utils/characters-tw.json",
			validateUrls: true,
			deduplicate: true,
			enableCommitTracking: true,
			commitStorageFile: "src/utils/commit-info-tw.json"
		});

		// Characters EN 更新配置 - 使用動態 URL 和 commit 追蹤
		this.addConfig({
			name: "characters-en",
			type: "dynamic-json",
			enabled: true,
			checkInterval: 24 * 60 * 60 * 1000, // 24小時
			dynamicUrlSource:
				"https://raw.githubusercontent.com/IsolateOB/ExiaInvasion/main/exia-invasion/src/api.js",
			urlPattern: "NIKKE_EN_URL\\s*=\\s*['\"`]([^'\"`]+)['\"`]",
			jsonOutputFile: "src/utils/characters-en.json",
			validateUrls: true,
			deduplicate: true,
			enableCommitTracking: true,
			commitStorageFile: "src/utils/commit-info-en.json"
		});

		// URL 監控配置
		this.addConfig({
			name: "url-monitor",
			type: "url-monitor",
			enabled: true,
			checkInterval: 24 * 60 * 60 * 1000, // 24小時
			notebookUrl:
				"https://raw.githubusercontent.com/IsolateOB/ExiaInvasion/main/exia-invasion/src/api.js",
			twUrlPattern: "NIKKE_TW_URL\\s*=\\s*['\"`]([^'\"`]+)['\"`]",
			enUrlPattern: "NIKKE_EN_URL\\s*=\\s*['\"`]([^'\"`]+)['\"`]"
		});
	}

	/**
	 * 添加更新配置
	 */
	addConfig(config: UpdateConfig): void {
		this.configs.set(config.name, config);
		this.statuses.set(config.name, {
			name: config.name,
			isRunning: false,
			lastCheck: null,
			nextCheck: null,
			lastUpdate: null,
			status: "disabled"
		});
	}

	/**
	 * 啟動所有啟用的更新任務
	 */
	start(): void {
		this.logger.info("🚀 啟動統一更新管理器...");

		for (const [name, config] of this.configs) {
			if (config.enabled) {
				this.startTask(name);
			}
		}

		this.logger.success("統一更新管理器已啟動");
	}

	/**
	 * 停止所有更新任務
	 */
	stop(): void {
		this.logger.info("⏹️ 停止統一更新管理器...");

		for (const [name, interval] of this.intervals) {
			clearInterval(interval);
			this.intervals.delete(name);

			const status = this.statuses.get(name);
			if (status) {
				status.isRunning = false;
				status.nextCheck = null;
			}
		}

		this.logger.success("統一更新管理器已停止");
	}

	/**
	 * 啟動特定任務
	 */
	private startTask(name: string): void {
		const config = this.configs.get(name);
		if (!config || !config.enabled) return;

		const status = this.statuses.get(name);
		if (!status) return;

		// 立即執行一次檢查
		this.performUpdate(name);

		// 設定定時器
		const interval = setInterval(() => {
			this.performUpdate(name);
		}, config.checkInterval);

		this.intervals.set(name, interval);
		status.isRunning = true;
		status.nextCheck = new Date(Date.now() + config.checkInterval);

		this.logger.info(`✅ 啟動任務: ${name}`);
	}

	/**
	 * 執行更新任務
	 */
	private async performUpdate(name: string): Promise<void> {
		const config = this.configs.get(name);
		const status = this.statuses.get(name);

		if (!config || !status) return;

		try {
			status.lastCheck = new Date();
			status.status = "pending";

			let success = false;

			switch (config.type) {
				case "github":
					success = await this.updateGitHubFiles(config);
					break;
				case "json":
					success = await this.updateJsonData(config);
					break;
				case "dynamic-json":
					success = await this.updateDynamicJsonData(config);
					break;
				case "url-monitor":
					success = await this.updateUrlMonitor(config);
					break;
			}

			if (success) {
				status.status = "success";
				status.lastUpdate = new Date();
				this.logger.info(`✅ ${name} 更新成功`);
			} else {
				status.status = "error";
				this.logger.warn(`⚠️ ${name} 更新失敗`);
			}
		} catch (error) {
			status.status = "error";
			status.error = (error as Error).message;
			this.logger.error(`${name} 更新失敗:`, error);
		}
	}

	/**
	 * 更新 GitHub 文件
	 */
	private async updateGitHubFiles(config: UpdateConfig): Promise<boolean> {
		if (!config.githubRepo || !config.githubPath || !config.localPath) {
			throw new Error("GitHub 配置不完整");
		}

		try {
			// 檢查是否有更新
			const hasUpdates = await this.checkGitHubUpdates(config);
			if (!hasUpdates) {
				return true; // 無需更新
			}

			// 下載文件
			await this.downloadGitHubFiles(config);
			return true;
		} catch (error) {
			this.logger.error("GitHub 文件更新失敗:", error);
			return false;
		}
	}

	/**
	 * 檢查 GitHub 更新
	 */
	private async checkGitHubUpdates(config: UpdateConfig): Promise<boolean> {
		const apiUrl = `https://api.github.com/repos/${config.githubRepo}/contents/${config.githubPath}`;

		const response = await fetch(apiUrl, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				Accept: "application/vnd.github.v3+json"
			}
		});

		if (!response.ok) {
			if (response.status === 403) {
				this.logger.warn("GitHub API 速率限制");
				return false;
			}
			throw new Error(
				`GitHub API 錯誤: ${response.status} ${response.statusText}`
			);
		}

		const files = (await response.json()) as GitHubFile[];
		const remoteFiles = files
			.filter(file => file.type === "file")
			.filter(file => this.isValidFile(file.name, config))
			.filter(file => !this.shouldExcludeFile(file.name, config))
			.map(file => file.name)
			.sort();

		// 獲取本地文件列表
		const localFiles = await this.getLocalFileList(
			config.localPath!,
			config
		);
		const localFileNames = localFiles.sort();

		// 比較文件列表
		return this.compareFileLists(localFileNames, remoteFiles);
	}

	/**
	 * 下載 GitHub 文件
	 */
	private async downloadGitHubFiles(config: UpdateConfig): Promise<void> {
		const apiUrl = `https://api.github.com/repos/${config.githubRepo}/contents/${config.githubPath}`;

		const response = await fetch(apiUrl, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				Accept: "application/vnd.github.v3+json"
			}
		});

		const files = (await response.json()) as GitHubFile[];
		const validFiles = files
			.filter(file => file.type === "file")
			.filter(file => this.isValidFile(file.name, config))
			.filter(file => !this.shouldExcludeFile(file.name, config));

		// 確保本地目錄存在
		await fs.mkdir(config.localPath!, { recursive: true });

		// 下載文件
		for (const file of validFiles) {
			try {
				const localFilePath = path.join(config.localPath!, file.name);

				// 檢查文件是否已存在
				try {
					await fs.access(localFilePath);
					continue; // 跳過已存在的文件
				} catch {
					// 文件不存在，繼續下載
				}

				this.logger.info(
					`下載文件: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`
				);

				const fileResponse = await fetch(file.download_url, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
					}
				});

				if (!fileResponse.ok) {
					throw new Error(
						`下載失敗: ${fileResponse.status} ${fileResponse.statusText}`
					);
				}

				const buffer = await fileResponse.arrayBuffer();
				await fs.writeFile(localFilePath, Buffer.from(buffer));
			} catch (error) {
				this.logger.error(`下載文件失敗 ${file.name}:`, error);
			}
		}
	}

	/**
	 * 更新 JSON 數據
	 */
	private async updateJsonData(config: UpdateConfig): Promise<boolean> {
		if (!config.jsonSources || !config.jsonOutputFile) {
			throw new Error("JSON 配置不完整");
		}

		try {
			let successCount = 0;
			let failCount = 0;

			for (const source of config.jsonSources) {
				try {
					this.logger.info(
						`下載 JSON 數據: ${source} -> ${config.jsonOutputFile}`
					);

					const response = await fetch(source, {
						headers: {
							"User-Agent":
								"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
							Accept: "application/json, text/plain, */*"
						}
					});

					if (!response.ok) {
						throw new Error(
							`HTTP ${response.status}: ${response.statusText}`
						);
					}

					const content = await response.text();
					const jsonData = JSON.parse(content);

					// 保存 JSON 數據
					await fs.writeFile(
						config.jsonOutputFile,
						JSON.stringify(jsonData, null, 2),
						"utf-8"
					);

					successCount++;
					this.logger.success(
						`成功下載並保存 JSON 數據到: ${config.jsonOutputFile}`
					);
				} catch (error) {
					failCount++;
					this.logger.error(`下載 JSON 數據源失敗 ${source}:`, error);
				}
			}

			return failCount === 0;
		} catch (error) {
			this.logger.error("JSON 數據更新失敗:", error);
			return false;
		}
	}

	/**
	 * 更新動態 JSON 數據
	 */
	private async updateDynamicJsonData(
		config: UpdateConfig
	): Promise<boolean> {
		try {
			if (
				!config.dynamicUrlSource ||
				!config.urlPattern ||
				!config.jsonOutputFile
			) {
				throw new Error("動態 JSON 配置不完整");
			}

			this.logger.info(`🔄 檢查動態 URL: ${config.dynamicUrlSource}`);

			// 從 notebook 中提取 URL
			const extractedUrl = await this.extractUrlFromNotebook(config);
			if (!extractedUrl) {
				this.logger.warn("未能從 notebook 中提取到 URL");
				return false;
			}

			// 如果啟用了 commit 追蹤，檢查是否需要更新
			if (config.enableCommitTracking && config.commitStorageFile) {
				const shouldUpdate = await this.checkCommitAndUpdate(
					config,
					extractedUrl
				);
				if (!shouldUpdate) {
					this.logger.info(
						`⏭️ ${config.name} 無需更新，commit 未變化`
					);
					return true; // 返回 true 表示檢查成功，只是不需要更新
				}
			}

			this.logger.info(
				`📥 下載 JSON 數據: ${extractedUrl} -> ${config.jsonOutputFile}`
			);

			// 下載 JSON 數據
			const response = await fetch(extractedUrl, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					Accept: "application/json, text/plain, */*"
				}
			});

			if (!response.ok) {
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}`
				);
			}

			const content = await response.text();
			const jsonData = JSON.parse(content);

			// 保存 JSON 數據
			await fs.writeFile(
				config.jsonOutputFile,
				JSON.stringify(jsonData, null, 2),
				"utf-8"
			);

			// 如果啟用了 commit 追蹤，更新 commit 信息
			if (config.enableCommitTracking && config.commitStorageFile) {
				await this.updateCommitInfo(config, extractedUrl);
			}

			this.logger.success(
				`✅ 成功下載並保存動態 JSON 數據到: ${config.jsonOutputFile}`
			);
			return true;
		} catch (error) {
			this.logger.error("動態 JSON 數據更新失敗:", error);
			return false;
		}
	}

	/**
	 * 更新 URL 監控
	 */
	private async updateUrlMonitor(config: UpdateConfig): Promise<boolean> {
		if (!config.notebookUrl) {
			throw new Error("URL 監控配置不完整");
		}

		try {
			this.logger.info("🔍 檢查 notebook 中的 URL 變化...");

			const currentUrls = await this.extractUrlsFromNotebook(config);
			if (!currentUrls) {
				this.logger.error("無法從 notebook 中提取 URL");
				return false;
			}

			// 如果是第一次檢查，保存當前 URL
			if (!this.lastKnownUrls) {
				this.lastKnownUrls = currentUrls;
				this.logger.info("📝 首次檢查，保存當前 URL 配置");
				return true;
			}

			// 比較 URL 是否有變化
			const hasChanges = this.compareUrls(
				this.lastKnownUrls,
				currentUrls
			);

			if (hasChanges) {
				this.logger.info("🔄 檢測到 URL 變化，開始下載新數據...");
				await this.downloadNewDataFromUrls(currentUrls);
				this.lastKnownUrls = currentUrls;
				this.logger.success("✅ 新數據下載完成");
			} else {
				this.logger.info("✅ URL 無變化，無需更新");
			}

			return true;
		} catch (error) {
			this.logger.error("URL 監控更新失敗:", error);
			return false;
		}
	}

	/**
	 * 從 notebook 中提取單個 URL
	 */
	private async extractUrlFromNotebook(
		config: UpdateConfig
	): Promise<string | null> {
		const response = await fetch(config.dynamicUrlSource!);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const sourceCode = await response.text();
		const urlMatch = sourceCode.match(new RegExp(config.urlPattern!));
		if (urlMatch && urlMatch[1]) {
			return urlMatch[1];
		}

		return null;
	}

	/**
	 * 從 notebook 中提取 URL
	 */
	private async extractUrlsFromNotebook(
		config: UpdateConfig
	): Promise<UrlConfig | null> {
		const response = await fetch(config.notebookUrl!);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		// 檢查來源是 Jupyter notebook 還是 JavaScript 文件
		const contentType = response.headers.get("content-type") || "";
		const isJavaScript =
			config.notebookUrl!.endsWith(".js") ||
			contentType.includes("javascript") ||
			contentType.includes("text/plain");

		if (isJavaScript) {
			// 處理 JavaScript 文件
			const sourceCode = await response.text();

			// 查找 tw_url 和 en_url 定義
			const twUrlMatch = sourceCode.match(
				new RegExp(
					config.twUrlPattern ||
						"NIKKE_TW_URL\\s*=\\s*['\"`]([^'\"`]+)['\"`]"
				)
			);
			const enUrlMatch = sourceCode.match(
				new RegExp(
					config.enUrlPattern ||
						"NIKKE_EN_URL\\s*=\\s*['\"`]([^'\"`]+)['\"`]"
				)
			);

			if (twUrlMatch && enUrlMatch && twUrlMatch[1] && enUrlMatch[1]) {
				return {
					twUrl: twUrlMatch[1],
					enUrl: enUrlMatch[1]
				};
			}
		} else {
			// 處理 Jupyter notebook 文件（保持向後兼容）
			const notebook = (await response.json()) as any;

			// 查找包含 URL 定義的 cell
			for (const cell of notebook.cells) {
				if (cell.cell_type === "code" && cell.source) {
					const sourceCode = Array.isArray(cell.source)
						? cell.source.join("")
						: cell.source;

					// 查找 tw_url 和 en_url 定義
					const twUrlMatch = sourceCode.match(
						new RegExp(
							config.twUrlPattern ||
								"tw_url\\s*=\\s*['\"`]([^'\"`]+)['\"`]"
						)
					);
					const enUrlMatch = sourceCode.match(
						new RegExp(
							config.enUrlPattern ||
								"en_url\\s*=\\s*['\"`]([^'\"`]+)['\"`]"
						)
					);

					if (twUrlMatch && enUrlMatch) {
						return {
							twUrl: twUrlMatch[1],
							enUrl: enUrlMatch[1]
						};
					}
				}
			}
		}

		return null;
	}

	/**
	 * 比較兩個 URL 配置
	 */
	private compareUrls(oldUrls: UrlConfig, newUrls: UrlConfig): boolean {
		return (
			oldUrls.twUrl !== newUrls.twUrl || oldUrls.enUrl !== newUrls.enUrl
		);
	}

	/**
	 * 從 URL 下載新數據
	 */
	private async downloadNewDataFromUrls(urls: UrlConfig): Promise<void> {
		// 下載 TW 數據
		const twConfig = this.configs.get("characters-tw");
		if (twConfig) {
			twConfig.jsonSources = [urls.twUrl];
			await this.updateJsonData(twConfig);
		}

		// 下載 EN 數據
		const enConfig = this.configs.get("characters-en");
		if (enConfig) {
			enConfig.jsonSources = [urls.enUrl];
			await this.updateJsonData(enConfig);
		}
	}

	/**
	 * 檢查是否為有效文件
	 */
	private isValidFile(fileName: string, config: UpdateConfig): boolean {
		if (!config.fileExtensions) return true;
		const ext = path.extname(fileName).toLowerCase();
		return config.fileExtensions.includes(ext);
	}

	/**
	 * 檢查是否應該排除此文件
	 */
	private shouldExcludeFile(fileName: string, config: UpdateConfig): boolean {
		if (!config.excludePatterns) return false;
		const lowerFileName = fileName.toLowerCase();
		return config.excludePatterns.some(pattern =>
			lowerFileName.includes(pattern.toLowerCase())
		);
	}

	/**
	 * 獲取本地文件列表
	 */
	private async getLocalFileList(
		localPath: string,
		config: UpdateConfig
	): Promise<string[]> {
		try {
			const files = await fs.readdir(localPath);
			return files.filter(file => {
				if (file.startsWith(".")) return false;
				if (!config.fileExtensions) return true;
				const ext = path.extname(file).toLowerCase();
				return config.fileExtensions.includes(ext);
			});
		} catch {
			return [];
		}
	}

	/**
	 * 比較文件列表
	 */
	private compareFileLists(
		localFiles: string[],
		remoteFiles: string[]
	): boolean {
		if (localFiles.length === 0) return true;
		if (localFiles.length !== remoteFiles.length) return true;

		for (let i = 0; i < localFiles.length; i++) {
			if (localFiles[i] !== remoteFiles[i]) return true;
		}
		return false;
	}

	/**
	 * 手動觸發所有更新
	 */
	async forceUpdateAll(): Promise<{ [key: string]: boolean }> {
		this.logger.info("🔄 手動執行所有更新...");

		const results: { [key: string]: boolean } = {};

		for (const [name, config] of this.configs) {
			if (config.enabled) {
				try {
					await this.performUpdate(name);
					results[name] = true;
				} catch (error) {
					this.logger.error(`${name} 手動更新失敗:`, error);
					results[name] = false;
				}
			}
		}

		return results;
	}

	/**
	 * 手動觸發特定任務更新
	 */
	async forceUpdate(name: string): Promise<boolean> {
		const config = this.configs.get(name);
		if (!config || !config.enabled) {
			this.logger.warn(`任務 ${name} 不存在或未啟用`);
			return false;
		}

		try {
			await this.performUpdate(name);
			return true;
		} catch (error) {
			this.logger.error(`${name} 手動更新失敗:`, error);
			return false;
		}
	}

	/**
	 * 獲取所有任務狀態
	 */
	getAllStatus(): UpdateStatus[] {
		return Array.from(this.statuses.values());
	}

	/**
	 * 獲取特定任務狀態
	 */
	getStatus(name: string): UpdateStatus | null {
		return this.statuses.get(name) || null;
	}

	/**
	 * 檢查是否正在運行
	 */
	isRunning(): boolean {
		return this.intervals.size > 0;
	}

	/**
	 * 啟用/禁用任務
	 */
	setTaskEnabled(name: string, enabled: boolean): void {
		const config = this.configs.get(name);
		if (!config) return;

		config.enabled = enabled;

		if (enabled && !this.intervals.has(name)) {
			this.startTask(name);
		} else if (!enabled && this.intervals.has(name)) {
			const interval = this.intervals.get(name);
			if (interval) {
				clearInterval(interval);
				this.intervals.delete(name);
			}

			const status = this.statuses.get(name);
			if (status) {
				status.isRunning = false;
				status.nextCheck = null;
			}
		}
	}

	/**
	 * 檢查 commit 並決定是否需要更新
	 */
	private async checkCommitAndUpdate(
		config: UpdateConfig,
		url: string
	): Promise<boolean> {
		try {
			// 讀取上次的 commit 信息
			const lastCommitInfo = await this.loadCommitInfo(
				config.commitStorageFile!
			);

			// 獲取當前 URL 的 commit hash
			const currentCommitHash = await this.getCommitHashFromUrl(url);

			if (!currentCommitHash) {
				this.logger.warn(`無法獲取 URL 的 commit hash: ${url}`);
				return true; // 如果無法獲取 commit hash，則下載
			}

			// 如果是第一次運行或 commit hash 不同，則需要更新
			if (
				!lastCommitInfo ||
				lastCommitInfo.commitHash !== currentCommitHash
			) {
				this.logger.info(
					`🔄 檢測到 commit 變化: ${lastCommitInfo?.commitHash || "無"} -> ${currentCommitHash}`
				);
				return true;
			}

			this.logger.info(`✅ Commit 未變化: ${currentCommitHash}`);
			return false;
		} catch (error) {
			this.logger.error("檢查 commit 失敗:", error);
			return true; // 如果檢查失敗，則下載
		}
	}

	/**
	 * 更新 commit 信息
	 */
	private async updateCommitInfo(
		config: UpdateConfig,
		url: string
	): Promise<void> {
		try {
			const commitHash = await this.getCommitHashFromUrl(url);
			if (!commitHash) {
				this.logger.warn(`無法獲取 commit hash: ${url}`);
				return;
			}

			const commitInfo: CommitInfo = {
				commitHash,
				timestamp: Date.now(),
				url
			};

			await fs.writeFile(
				config.commitStorageFile!,
				JSON.stringify(commitInfo, null, 2),
				"utf-8"
			);

			this.logger.info(`💾 已保存 commit 信息: ${commitHash}`);
		} catch (error) {
			this.logger.error("保存 commit 信息失敗:", error);
		}
	}

	/**
	 * 從 URL 獲取 commit hash
	 */
	private async getCommitHashFromUrl(url: string): Promise<string | null> {
		try {
			// 對於 GitHub raw URL，我們需要從響應頭中獲取 commit hash
			// 或者通過 GitHub API 獲取文件的最新 commit

			// 如果是 GitHub raw URL，嘗試從 URL 中提取 repo 和 path
			const githubRawMatch = url.match(
				/https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/
			);
			if (githubRawMatch) {
				const [, owner, repo, branch, path] = githubRawMatch;

				// 使用 GitHub API 獲取文件的最新 commit
				const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits?path=${path}&per_page=1`;
				const response = await fetch(apiUrl, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
						Accept: "application/vnd.github.v3+json"
					}
				});

				if (response.ok) {
					const commits = (await response.json()) as GitHubCommit[];
					if (commits.length > 0 && commits[0]) {
						return commits[0].sha;
					}
				}
			}

			// 如果不是 GitHub URL 或無法獲取 commit hash，使用 URL 的 hash
			// 這是一個簡化的方法，對於非 GitHub URL 可能不夠準確
			return this.generateUrlHash(url);
		} catch (error) {
			this.logger.error("獲取 commit hash 失敗:", error);
			return null;
		}
	}

	/**
	 * 為 URL 生成 hash（用於非 GitHub URL）
	 */
	private generateUrlHash(url: string): string {
		// 簡單的 hash 生成，實際應用中可能需要更複雜的邏輯
		let hash = 0;
		for (let i = 0; i < url.length; i++) {
			const char = url.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return Math.abs(hash).toString(16);
	}

	/**
	 * 讀取 commit 信息
	 */
	private async loadCommitInfo(filePath: string): Promise<CommitInfo | null> {
		try {
			const data = await fs.readFile(filePath, "utf-8");
			return JSON.parse(data) as CommitInfo;
		} catch (error) {
			// 文件不存在或讀取失敗，返回 null
			return null;
		}
	}
}

// 導出單例實例
export const updateManager = new UpdateManager();
