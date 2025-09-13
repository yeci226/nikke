import { Scheduler, SchedulerConfig } from "./scheduler.js";
import { Logger } from "../services/logger.js";

export class AutoUpdater {
	private scheduler: Scheduler;
	private readonly logger = new Logger("自動更新器");

	constructor() {
		const config: SchedulerConfig = {
			spriteConfig: {
				githubRepo: "Nikke-db/Nikke-db.github.io",
				githubPath: "images/sprite",
				localPath: "src/assets/images/sprite",
				checkInterval: 24 * 60 * 60 * 1000, // 24小時
				enableAutoDownload: true
			},
			urlConfig: {
				sources: [
					"https://raw.githubusercontent.com/IsolateOB/ExiaInvasion/b18be75c2b5ec7fd609952015fe5ed660543c063/fetch_nikke_list.ipynb"
				],
				outputFile: "src/utils/tw_urls.json",
				enableBackup: true,
				validateUrls: true,
				deduplicate: true
			},
			checkInterval: 24 * 60 * 60 * 1000, // 24小時
			enableSpriteUpdates: true,
			enableUrlUpdates: true
		};

		this.scheduler = new Scheduler(config);
	}

	/**
	 * 啟動自動更新
	 */
	start(): void {
		this.logger.info("🚀 啟動自動更新系統...");
		this.scheduler.start();
	}

	/**
	 * 停止自動更新
	 */
	stop(): void {
		this.logger.info("⏹️ 停止自動更新系統...");
		this.scheduler.stop();
	}

	/**
	 * 手動執行所有更新
	 */
	async forceUpdateAll(): Promise<void> {
		this.logger.info("🔄 手動執行所有更新...");
		await this.scheduler.forceUpdateAll();
	}

	/**
	 * 獲取系統狀態
	 */
	async getStatus(): Promise<any> {
		return await this.scheduler.getStatus();
	}

	/**
	 * 檢查是否正在運行
	 */
	isRunning(): boolean {
		return this.scheduler.isSchedulerRunning();
	}
}

// 導出單例實例
export const autoUpdater = new AutoUpdater();
