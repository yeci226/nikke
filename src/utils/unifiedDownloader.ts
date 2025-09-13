import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { Logger } from "../services/logger.js";

// ==================== 接口定义 ====================

export interface GitHubFile {
	name: string;
	path: string;
	download_url: string;
	size: number;
	type: string;
}

export interface TwUrlData {
	url: string;
	timestamp: number;
	source: string;
}

export interface DownloadConfig {
	githubRepo: string;
	githubPath: string;
	localPath: string;
	checkInterval?: number; // 检查间隔（毫秒）
	enableAutoDownload?: boolean;
	excludePatterns?: string[]; // 排除的文件模式
	fileExtensions?: string[]; // 允许的文件扩展名
}

export interface UrlSourceConfig {
	sources?: string[];
	outputFile?: string;
	enableBackup?: boolean;
	validateUrls?: boolean;
	deduplicate?: boolean;
	enableCommitCheck?: boolean;
}

export interface DownloadStats {
	localFiles: number;
	remoteFiles: number;
	missingFiles: number;
	lastCheck: Date | null;
	nextCheck: Date | null;
}

// ==================== 统一下载管理器 ====================

export class UnifiedDownloader {
	private config: DownloadConfig;
	private urlConfig: UrlSourceConfig;
	private readonly logger = new Logger("下載器");
	private lastCheckTime: number = 0;
	private lastFileList: string[] = [];
	private lastCommitHashes: Map<string, string> = new Map();

	constructor(downloadConfig: DownloadConfig, urlConfig?: UrlSourceConfig) {
		this.config = {
			checkInterval: 24 * 60 * 60 * 1000, // 默认24小时
			enableAutoDownload: true,
			excludePatterns: ["4koma", "4格", "四格", "comic"],
			fileExtensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
			...downloadConfig
		};

		this.urlConfig = {
			sources: [],
			enableBackup: false,
			validateUrls: true,
			deduplicate: true,
			enableCommitCheck: true,
			...urlConfig
		};
	}

	// ==================== GitHub 文件下载 ====================

	/**
	 * 检查 GitHub 文件夹是否有更新
	 */
	async checkForUpdates(): Promise<boolean> {
		try {
			const currentFiles = await this.getGitHubFileList();
			const hasUpdates = this.hasFileChanges(currentFiles);

			if (hasUpdates) {
				this.lastFileList = currentFiles.map(file => file.name);
				this.lastCheckTime = Date.now();
				return true;
			}
			return false;
		} catch (error) {
			this.logger.error("檢查更新失敗:", error);
			throw error;
		}
	}

	/**
	 * 獲取 GitHub 文件夾中的文件列表
	 */
	private async getGitHubFileList(): Promise<GitHubFile[]> {
		const apiUrl = `https://api.github.com/repos/${this.config.githubRepo}/contents/${this.config.githubPath}`;

		const response = await fetch(apiUrl, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				Accept: "application/vnd.github.v3+json"
			}
		});

		if (!response.ok) {
			if (response.status === 403) {
				this.logger.warn("GitHub API 速率限制，使用空文件列表");
				return [];
			}
			throw new Error(
				`GitHub API 錯誤: ${response.status} ${response.statusText}`
			);
		}

		const files = (await response.json()) as GitHubFile[];
		return files
			.filter(file => file.type === "file")
			.filter(file => this.isValidFile(file.name))
			.filter(file => !this.shouldExcludeFile(file.name));
	}

	/**
	 * 檢查是否為有效文件
	 */
	private isValidFile(fileName: string): boolean {
		if (!this.config.fileExtensions) return true;
		const ext = path.extname(fileName).toLowerCase();
		return this.config.fileExtensions.includes(ext);
	}

	/**
	 * 檢查是否應該排除此文件
	 */
	private shouldExcludeFile(fileName: string): boolean {
		if (!this.config.excludePatterns) return false;
		const lowerFileName = fileName.toLowerCase();
		return this.config.excludePatterns.some(pattern =>
			lowerFileName.includes(pattern.toLowerCase())
		);
	}

	/**
	 * 檢查是否有文件變化
	 */
	private hasFileChanges(currentFiles: GitHubFile[]): boolean {
		const currentFileNames = currentFiles.map(file => file.name).sort();

		if (this.lastFileList.length === 0) return true;
		if (currentFileNames.length !== this.lastFileList.length) return true;

		for (let i = 0; i < currentFileNames.length; i++) {
			if (currentFileNames[i] !== this.lastFileList[i]) return true;
		}
		return false;
	}

	/**
	 * 下載所有文件
	 */
	async downloadAllFiles(): Promise<boolean> {
		try {
			await this.ensureLocalDirectory();

			const files = await this.getGitHubFileList();
			let successCount = 0;
			let skipCount = 0;
			let failCount = 0;

			for (const file of files) {
				try {
					const downloaded = await this.downloadFile(file);
					if (downloaded) {
						successCount++;
					} else {
						skipCount++;
					}
				} catch (error) {
					this.logger.error(`下載文件失敗 ${file.name}:`, error);
					failCount++;
				}
			}

			return failCount === 0;
		} catch (error) {
			this.logger.error("下載文件失敗:", error);
			throw error;
		}
	}

	/**
	 * 下載單個文件
	 */
	private async downloadFile(file: GitHubFile): Promise<boolean> {
		const localFilePath = path.join(this.config.localPath, file.name);

		// 檢查文件是否已存在
		try {
			await fs.access(localFilePath);
			return false; // 跳過已存在的文件
		} catch {
			// 文件不存在，繼續下載
		}

		this.logger.info(
			`下載文件: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`
		);

		const response = await fetch(file.download_url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
			}
		});

		if (!response.ok) {
			throw new Error(
				`下載失敗: ${response.status} ${response.statusText}`
			);
		}

		const buffer = await response.buffer();
		await fs.writeFile(localFilePath, buffer);
		return true;
	}

	/**
	 * 確保本地文件夾存在
	 */
	private async ensureLocalDirectory(): Promise<void> {
		try {
			await fs.mkdir(this.config.localPath, { recursive: true });
		} catch (error) {
			this.logger.error("創建本地文件夾失敗:", error);
			throw error;
		}
	}

	/**
	 * 獲取本地文件列表
	 */
	async getLocalFileList(): Promise<string[]> {
		try {
			const files = await fs.readdir(this.config.localPath);
			return files.filter(file => {
				if (file.startsWith(".")) return false;
				if (!this.config.fileExtensions) return true;
				const ext = path.extname(file).toLowerCase();
				return this.config.fileExtensions.includes(ext);
			});
		} catch {
			return [];
		}
	}

	/**
	 * 隨機選擇一個文件
	 */
	async getRandomFile(): Promise<string | null> {
		try {
			const files = await this.getLocalFileList();
			if (files.length === 0) {
				this.logger.warn("沒有可用的文件");
				return null;
			}

			const randomIndex = Math.floor(Math.random() * files.length);
			const selectedFile = files[randomIndex];
			if (!selectedFile) {
				this.logger.warn("無法選擇文件");
				return null;
			}
			const fullPath = path.join(this.config.localPath, selectedFile);

			this.logger.info(`隨機選擇文件: ${selectedFile}`);
			return fullPath;
		} catch (error) {
			this.logger.error("獲取隨機文件失敗:", error);
			return null;
		}
	}

	// ==================== URL 抓取功能 ====================

	/**
	 * 從所有源抓取 URL
	 */
	async fetchFromAllSources(): Promise<TwUrlData[]> {
		const allUrls: TwUrlData[] = [];

		if (!this.urlConfig.sources || this.urlConfig.sources.length === 0) {
			return allUrls;
		}

		for (const source of this.urlConfig.sources) {
			try {
				if (
					this.urlConfig.enableCommitCheck &&
					this.isGitHubRawUrl(source)
				) {
					const hasUpdates =
						await this.checkGitHubCommitUpdate(source);
					if (!hasUpdates) continue;
				}

				let urls: TwUrlData[];
				if (this.isGitHubRawUrl(source)) {
					urls = await this.fetchFromGitHubRaw(source);
				} else {
					urls = await this.fetchFromWebPage(source);
				}

				allUrls.push(...urls);
			} catch (error) {
				this.logger.error(`從 ${source} 抓取失敗:`, error);
			}
		}

		return allUrls;
	}

	/**
	 * 從 GitHub raw URL 抓取内容
	 */
	async fetchFromGitHubRaw(githubRawUrl: string): Promise<TwUrlData[]> {
		try {
			const response = await fetch(githubRawUrl, {
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
			return this.extractTwUrlsFromNotebook(content, githubRawUrl);
		} catch (error) {
			this.logger.error("抓取 GitHub raw URL 失敗:", error);
			throw error;
		}
	}

	/**
	 * 從網頁抓取内容
	 */
	async fetchFromWebPage(url: string): Promise<TwUrlData[]> {
		try {
			this.logger.info(`抓取網頁: ${url}`);

			const response = await fetch(url, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
				}
			});

			if (!response.ok) {
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}`
				);
			}

			const html = await response.text();
			return this.extractTwUrlsFromHtml(html, url);
		} catch (error) {
			this.logger.error("抓取網頁失敗:", error);
			throw error;
		}
	}

	/**
	 * 從 Jupyter notebook 内容中提取 tw_url
	 */
	private extractTwUrlsFromNotebook(
		content: string,
		source: string
	): TwUrlData[] {
		try {
			const notebook = JSON.parse(content);
			const twUrls: TwUrlData[] = [];
			const timestamp = Date.now();

			if (notebook.cells) {
				for (const cell of notebook.cells) {
					if (cell.source && Array.isArray(cell.source)) {
						const cellContent = cell.source.join("");
						const patterns = [
							/tw_url\s*=\s*["']([^"']+)["']/gi,
							/"tw_url"\s*:\s*"([^"]+)"/gi,
							/tw_url[:\s]*["']([^"']+)["']/gi,
							/name=["']tw_url["'][^>]*href=["']([^"']+)["']/gi,
							/href=["']([^"']+)["'][^>]*name=["']tw_url["']/gi
						];

						for (const pattern of patterns) {
							const matches = cellContent.match(pattern);
							if (matches) {
								for (const match of matches) {
									const urlMatch =
										match.match(/["']([^"']+)["']/);
									if (urlMatch && urlMatch[1]) {
										twUrls.push({
											url: urlMatch[1],
											timestamp,
											source
										});
									}
								}
							}
						}
					}
				}
			}

			return twUrls;
		} catch (error) {
			this.logger.error("解析 Jupyter notebook 內容失敗:", error);
			return [];
		}
	}

	/**
	 * 從 HTML 內容中提取 tw_url
	 */
	private extractTwUrlsFromHtml(html: string, source: string): TwUrlData[] {
		const twUrls: TwUrlData[] = [];
		const timestamp = Date.now();

		const patterns = [
			/tw_url[:\s]*["']([^"']+)["']/gi,
			/"tw_url"\s*:\s*"([^"]+)"/gi,
			/name=["']tw_url["'][^>]*href=["']([^"']+)["']/gi,
			/href=["']([^"']+)["'][^>]*name=["']tw_url["']/gi
		];

		for (const pattern of patterns) {
			const matches = html.match(pattern);
			if (matches) {
				for (const match of matches) {
					const urlMatch = match.match(/["']([^"']+)["']/);
					if (urlMatch && urlMatch[1]) {
						twUrls.push({
							url: urlMatch[1],
							timestamp,
							source
						});
					}
				}
			}
		}

		return twUrls;
	}

	// ==================== GitHub Commit 檢查 ====================

	/**
	 * 檢查是否為 GitHub raw URL
	 */
	private isGitHubRawUrl(url: string): boolean {
		return (
			url.includes("raw.githubusercontent.com") ||
			(url.includes("github.com") && url.includes("/blob/"))
		);
	}

	/**
	 * 檢查 GitHub 源是否有新的 commit
	 */
	private async checkGitHubCommitUpdate(
		githubRawUrl: string
	): Promise<boolean> {
		try {
			const repoInfo = this.extractRepoInfoFromRawUrl(githubRawUrl);
			if (!repoInfo) {
				this.logger.warn(`無法從 URL ${githubRawUrl} 提取 repo 信息`);
				return true;
			}

			const latestCommitHash = await this.getLatestCommitHash(repoInfo);
			if (!latestCommitHash) {
				this.logger.warn(
					`無法獲取 ${repoInfo.owner}/${repoInfo.repo} 的最新 commit`
				);
				return true;
			}

			const lastCommitHash = this.lastCommitHashes.get(githubRawUrl);
			if (lastCommitHash === latestCommitHash) {
				return false;
			}

			this.lastCommitHashes.set(githubRawUrl, latestCommitHash);
			return true;
		} catch (error) {
			this.logger.error("檢查 GitHub commit 更新失敗:", error);
			return true;
		}
	}

	/**
	 * 從 GitHub raw URL 提取 repo 資訊
	 */
	private extractRepoInfoFromRawUrl(
		rawUrl: string
	): { owner: string; repo: string; path: string } | null {
		try {
			const rawMatch = rawUrl.match(
				/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/
			);
			if (rawMatch && rawMatch[1] && rawMatch[2] && rawMatch[4]) {
				return {
					owner: rawMatch[1],
					repo: rawMatch[2],
					path: rawMatch[4]
				};
			}

			const blobMatch = rawUrl.match(
				/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/
			);
			if (blobMatch && blobMatch[1] && blobMatch[2] && blobMatch[4]) {
				return {
					owner: blobMatch[1],
					repo: blobMatch[2],
					path: blobMatch[4]
				};
			}

			return null;
		} catch (error) {
			this.logger.error("解析 GitHub URL 失敗:", error);
			return null;
		}
	}

	/**
	 * 獲取指定 repo 和路徑的最新 commit hash
	 */
	private async getLatestCommitHash(repoInfo: {
		owner: string;
		repo: string;
		path: string;
	}): Promise<string | null> {
		try {
			const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits?path=${encodeURIComponent(repoInfo.path)}&per_page=1`;

			const response = await fetch(apiUrl, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
					Accept: "application/vnd.github.v3+json"
				}
			});

			if (!response.ok) {
				throw new Error(
					`GitHub API 錯誤: ${response.status} ${response.statusText}`
				);
			}

			const commits = (await response.json()) as any[];
			return commits.length > 0 ? commits[0].sha : null;
		} catch (error) {
			this.logger.error("獲取 GitHub commit hash 失敗:", error);
			return null;
		}
	}

	// ==================== 統一管理功能 ====================

	/**
	 * 檢查是否需要更新（基於時間間隔）
	 */
	shouldCheckForUpdates(): boolean {
		const now = Date.now();
		return (
			now - this.lastCheckTime >=
			(this.config.checkInterval ?? 24 * 60 * 60 * 1000)
		);
	}

	/**
	 * 執行完整的檢查和更新流程
	 */
	async performUpdateCheck(): Promise<boolean> {
		if (!this.shouldCheckForUpdates()) {
			return false;
		}

		const hasUpdates = await this.checkForUpdates();

		if (hasUpdates && this.config.enableAutoDownload) {
			await this.downloadAllFiles();
			return true;
		}

		return hasUpdates;
	}

	/**
	 * 獲取下載統計
	 */
	async getDownloadStats(): Promise<DownloadStats> {
		const localFiles = await this.getLocalFileList();
		const remoteFiles = await this.getGitHubFileList();
		const remoteFileNames = remoteFiles.map(file => file.name);

		const missingFiles = remoteFileNames.filter(
			fileName => !localFiles.includes(fileName)
		).length;

		return {
			localFiles: localFiles.length,
			remoteFiles: remoteFiles.length,
			missingFiles: missingFiles,
			lastCheck:
				this.lastCheckTime > 0 ? new Date(this.lastCheckTime) : null,
			nextCheck:
				this.lastCheckTime > 0
					? new Date(
							this.lastCheckTime +
								(this.config.checkInterval ??
									24 * 60 * 60 * 1000)
						)
					: null
		};
	}

	/**
	 * 下載指定URL的內容並保存到文件
	 */
	async downloadUrlContent(
		url: string,
		outputFileName: string
	): Promise<boolean> {
		try {
			const response = await fetch(url, {
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

			try {
				const jsonData = JSON.parse(content);
				await fs.writeFile(
					outputFileName,
					JSON.stringify(jsonData, null, 2),
					"utf-8"
				);
			} catch {
				await fs.writeFile(outputFileName, content, "utf-8");
			}

			return true;
		} catch (error) {
			this.logger.error("下載URL內容到文件失敗:", error);
			throw error;
		}
	}

	/**
	 * 保存 commit hash 狀態到文件
	 */
	private async saveCommitHashes(): Promise<void> {
		try {
			const commitData = {
				lastUpdate: Date.now(),
				commitHashes: Object.fromEntries(this.lastCommitHashes)
			};

			const commitFilePath = this.urlConfig.outputFile
				? `${this.urlConfig.outputFile}.commits`
				: "src/utils/tw_urls.json.commits";

			await fs.writeFile(
				commitFilePath,
				JSON.stringify(commitData, null, 2),
				"utf-8"
			);
		} catch (error) {
			this.logger.error("保存 commit hash 狀態失敗:", error);
		}
	}

	/**
	 * 從文件加載 commit hash 狀態
	 */
	private async loadCommitHashes(): Promise<void> {
		try {
			const commitFilePath = this.urlConfig.outputFile
				? `${this.urlConfig.outputFile}.commits`
				: "src/utils/tw_urls.json.commits";

			const content = await fs.readFile(commitFilePath, "utf-8");
			const commitData = JSON.parse(content);

			if (commitData.commitHashes) {
				this.lastCommitHashes = new Map(
					Object.entries(commitData.commitHashes)
				);
			}
		} catch {
			this.logger.info("未找到 commit hash 狀態文件，將進行首次檢查");
		}
	}
}

/**
 * 創建 Sprite 下載器
 */
export function createSpriteDownloader(
	githubRepo: string,
	githubPath: string,
	localPath: string
): UnifiedDownloader {
	return new UnifiedDownloader({
		githubRepo,
		githubPath,
		localPath,
		fileExtensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"]
	});
}

/**
 * 創建 URL 抓取器
 */
export function createUrlFetcher(
	sources: string[],
	outputFile?: string
): UnifiedDownloader {
	const urlConfig: UrlSourceConfig = {
		sources
	};

	if (outputFile) {
		urlConfig.outputFile = outputFile;
	}

	return new UnifiedDownloader(
		{
			githubRepo: "",
			githubPath: "",
			localPath: ""
		},
		urlConfig
	);
}
