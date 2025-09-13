import {
	UnifiedDownloader,
	DownloadConfig,
	UrlSourceConfig
} from "./unifiedDownloader.js";
import { Logger } from "../services/logger.js";

export interface SchedulerConfig {
	spriteConfig: DownloadConfig;
	urlConfig: UrlSourceConfig;
	checkInterval?: number; // 檢查間隔（毫秒）
	enableSpriteUpdates?: boolean;
	enableUrlUpdates?: boolean;
}

export class Scheduler {
	private config: SchedulerConfig;
	private spriteDownloader: UnifiedDownloader;
	private urlUpdater: UnifiedDownloader;
	private readonly logger = new Logger("定時任務管理器");
	private intervalId: NodeJS.Timeout | null = null;
	private isRunning: boolean = false;

	constructor(config: SchedulerConfig) {
		this.config = {
			checkInterval: 24 * 60 * 60 * 1000, // 預設24小時
			enableSpriteUpdates: true,
			enableUrlUpdates: true,
			...config
		};

		this.spriteDownloader = new UnifiedDownloader(this.config.spriteConfig);
		this.urlUpdater = new UnifiedDownloader(
			{
				githubRepo: "",
				githubPath: "",
				localPath: ""
			},
			this.config.urlConfig
		);
	}

	/**
	 * 啟動定時任務
	 */
	start(): void {
		if (this.isRunning) {
			return;
		}

		// 立即執行一次檢查
		this.performScheduledCheck();

		// 設定定時器
		this.intervalId = setInterval(() => {
			this.performScheduledCheck();
		}, this.config.checkInterval);

		this.isRunning = true;
		this.logger.success("定時任務已啟動");
	}

	/**
	 * 停止定時任務
	 */
	stop(): void {
		if (!this.isRunning) {
			return;
		}

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		this.isRunning = false;
	}

	/**
	 * 執行定時檢查
	 */
	private async performScheduledCheck(): Promise<void> {
		try {
			const startTime = Date.now();

			// 並行執行所有檢查
			const tasks: Promise<boolean>[] = [];

			if (this.config.enableSpriteUpdates) {
				tasks.push(this.checkSpriteUpdates());
			}

			if (this.config.enableUrlUpdates) {
				tasks.push(this.checkUrlUpdates());
			}

			const results = await Promise.allSettled(tasks);

			const duration = Date.now() - startTime;

			// 記錄結果
			results.forEach((result, index) => {
				if (result.status === "fulfilled") {
					const taskName = index === 0 ? "Sprite更新" : "URL更新";
				} else {
					const taskName = index === 0 ? "Sprite更新" : "URL更新";
					this.logger.error(`${taskName}檢查失敗:`, result.reason);
				}
			});
		} catch (error) {
			this.logger.error("定時檢查失敗:", error);
		}
	}

	/**
	 * 檢查 Sprite 更新
	 */
	private async checkSpriteUpdates(): Promise<boolean> {
		try {
			return await this.spriteDownloader.performUpdateCheck();
		} catch (error) {
			this.logger.error("Sprite 更新檢查失敗:", error);
			return false;
		}
	}

	/**
	 * 檢查 URL 更新
	 */
	private async checkUrlUpdates(): Promise<boolean> {
		try {
			// 使用统一下载器的URL抓取功能
			const urls = await this.urlUpdater.fetchFromAllSources();
			// 这里可以添加URL处理逻辑
			return urls.length > 0;
		} catch (error) {
			this.logger.error("URL 更新檢查失敗:", error);
			return false;
		}
	}

	/**
	 * 手動觸發所有更新
	 */
	async forceUpdateAll(): Promise<{
		spriteUpdated: boolean;
		urlUpdated: boolean;
		charactersUpdated: boolean;
	}> {
		const results = {
			spriteUpdated: false,
			urlUpdated: false,
			charactersUpdated: false
		};

		try {
			// 更新 Sprite
			if (this.config.enableSpriteUpdates) {
				results.spriteUpdated =
					await this.spriteDownloader.downloadAllFiles();
			}

			// 更新 URL
			if (this.config.enableUrlUpdates) {
				const urls = await this.urlUpdater.fetchFromAllSources();
				results.urlUpdated = urls.length > 0;
			}

			// 下載 characters.json (需要实现)
			results.charactersUpdated = false; // 暂时禁用

			return results;
		} catch (error) {
			this.logger.error("手動更新失敗:", error);
			throw error;
		}
	}

	/**
	 * 獲取狀態資訊
	 */
	async getStatus(): Promise<{
		isRunning: boolean;
		nextCheck: Date | null;
		spriteStats: any;
		urlStats: any;
	}> {
		const spriteStats = await this.spriteDownloader.getDownloadStats();
		const urlStats = await this.urlUpdater.fetchFromAllSources();

		return {
			isRunning: this.isRunning,
			nextCheck: this.intervalId
				? new Date(Date.now() + this.config.checkInterval!)
				: null,
			spriteStats,
			urlStats: {
				count: urlStats.length,
				lastUpdated:
					urlStats.length > 0
						? new Date(Math.max(...urlStats.map(u => u.timestamp)))
						: null
			}
		};
	}

	/**
	 * 獲取運行狀態
	 */
	isSchedulerRunning(): boolean {
		return this.isRunning;
	}
}
