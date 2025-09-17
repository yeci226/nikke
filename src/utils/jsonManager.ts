import fs from "fs/promises";
import path from "path";
import { TwUrlData } from "./updateManager.js";
import { Logger } from "../services/logger.js";

export interface TwUrlStorage {
	urls: TwUrlData[];
	lastUpdated: number;
	version: string;
}

export class JsonManager {
	private readonly filePath: string;
	private readonly backupPath: string;
	private readonly logger = new Logger("JSON管理器");

	constructor(filePath: string = "tw_urls.json") {
		this.filePath = filePath;
		this.backupPath = `${filePath}.backup`;
	}

	/**
	 * 讀取現有的 JSON 檔案
	 */
	async readExistingData(): Promise<TwUrlStorage | null> {
		try {
			const data = await fs.readFile(this.filePath, "utf-8");
			const parsed = JSON.parse(data) as TwUrlStorage;
			return parsed;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			this.logger.error("讀取 JSON 檔案失敗:", error);
			throw error;
		}
	}

	/**
	 * 檢查是否有新的更新
	 */
	hasNewUpdates(
		existingData: TwUrlStorage | null,
		newUrls: TwUrlData[]
	): boolean {
		if (!existingData) {
			return true;
		}

		// 比較 URL 數量
		if (existingData.urls.length !== newUrls.length) {
			return true;
		}

		// 比較 URL 內容
		const existingUrls = existingData.urls.map(item => item.url).sort();
		const newUrlsList = newUrls.map(item => item.url).sort();

		for (let i = 0; i < existingUrls.length; i++) {
			if (existingUrls[i] !== newUrlsList[i]) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 備份現有檔案
	 */
	async backupExistingFile(): Promise<void> {
		try {
			await fs.copyFile(this.filePath, this.backupPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				this.logger.error("備份檔案失敗:", error);
			}
		}
	}

	/**
	 * 寫入新的 JSON 檔案
	 */
	async writeNewData(urls: TwUrlData[]): Promise<void> {
		const data: TwUrlStorage = {
			urls: urls.sort((a, b) => a.url.localeCompare(b.url)), // 按 URL 排序
			lastUpdated: Date.now(),
			version: "1.0.0"
		};

		try {
			// 直接寫入新檔案，不進行備份
			await fs.writeFile(
				this.filePath,
				JSON.stringify(data, null, 2),
				"utf-8"
			);
		} catch (error) {
			this.logger.error("寫入 JSON 檔案失敗:", error);
			throw error;
		}
	}

	/**
	 * 獲取檔案統計資訊
	 */
	async getFileStats(): Promise<{ size: number; modified: Date } | null> {
		try {
			const stats = await fs.stat(this.filePath);
			return {
				size: stats.size,
				modified: stats.mtime
			};
		} catch (error) {
			return null;
		}
	}

	/**
	 * 清理重複的 URL
	 */
	deduplicateUrls(urls: TwUrlData[]): TwUrlData[] {
		const seen = new Set<string>();
		const uniqueUrls: TwUrlData[] = [];

		for (const urlData of urls) {
			if (!seen.has(urlData.url)) {
				seen.add(urlData.url);
				uniqueUrls.push(urlData);
			}
		}

		return uniqueUrls;
	}

	/**
	 * 驗證 URL 格式
	 */
	validateUrls(urls: TwUrlData[]): TwUrlData[] {
		const validUrls: TwUrlData[] = [];
		const urlPattern = /^https?:\/\/.+/;

		for (const urlData of urls) {
			if (urlPattern.test(urlData.url)) {
				validUrls.push(urlData);
			} else {
				this.logger.warn(`無效的 URL 格式: ${urlData.url}`);
			}
		}

		return validUrls;
	}
}
