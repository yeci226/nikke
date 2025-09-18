import {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	AttachmentBuilder,
	MessageFlags,
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	ComponentType
} from "discord.js";
import databaseService from "../services/database.js";
import { Logger } from "../services/logger.js";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { join } from "path";
import charactersData from "../utils/characters-tw.json" with { type: "json" };
import charactersEnData from "../utils/characters-en.json" with { type: "json" };
import type { Character } from "../types/index.js";
import {
	getFontString,
	getUserCharacters,
	getUserCharacterDetails,
	cubeNameMap
} from "../utils/nikke.js";
import fs from "fs/promises";
import fetch from "node-fetch";
import { Vibrant } from "node-vibrant/node";
// @ts-ignore
import webp from "webp-converter";

// 類型安全的 characters 數組
const characters: Character[] = charactersData as Character[];
const charactersEn: Character[] = charactersEnData as Character[];

// 字體註冊
GlobalFonts.registerFromPath(
	join(".", "src", ".", "assets", "Deco_abltn_60_spacing.ttf"),
	"Deco"
);
GlobalFonts.registerFromPath(
	join(".", "src", ".", "assets", "YaHei.ttf"),
	"YaHei"
);
GlobalFonts.registerFromPath(
	join(".", "src", ".", "assets", "DINNextLTPro-Regular.woff2"),
	"DINNextLTPro"
);

const logger = new Logger();

// 記憶體監控工具類
class MemoryMonitor {
	private static readonly MEMORY_CHECK_INTERVAL = 2 * 60 * 1000; // 2分鐘
	private static readonly MEMORY_THRESHOLD = 500 * 1024 * 1024; // 500MB
	private static memoryCheckInterval: NodeJS.Timeout | null = null;

	static start(): void {
		if (this.memoryCheckInterval) return;

		this.memoryCheckInterval = setInterval(() => {
			try {
				const memUsage = process.memoryUsage();
				const heapUsed = memUsage.heapUsed;

				if (heapUsed > this.MEMORY_THRESHOLD) {
					logger.warn(
						`記憶體使用量過高: ${Math.round(heapUsed / 1024 / 1024)}MB`,
						{
							heapUsed,
							heapTotal: memUsage.heapTotal,
							external: memUsage.external
						}
					);

					// 強制垃圾回收
					if (global.gc) {
						global.gc();
						logger.debug("執行強制垃圾回收");
					}

					// 清理緩存
					CacheManager.cleanup();
					ImageLoader.cleanup();
					ResourceManager.clearPool();
				}
			} catch (error) {
				logger.error("記憶體監控失敗", { error });
			}
		}, this.MEMORY_CHECK_INTERVAL);
	}

	static stop(): void {
		if (this.memoryCheckInterval) {
			clearInterval(this.memoryCheckInterval);
			this.memoryCheckInterval = null;
		}
	}

	static getMemoryUsage(): NodeJS.MemoryUsage {
		return process.memoryUsage();
	}
}

// 定期清理機制
class CleanupManager {
	private static cleanupInterval: NodeJS.Timeout | null = null;
	private static readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分鐘

	static start(): void {
		if (this.cleanupInterval) return;

		this.cleanupInterval = setInterval(() => {
			try {
				CacheManager.cleanup();
				ImageLoader.cleanup();
				ResourceManager.clearPool();
				logger.debug("執行定期清理完成");
			} catch (error) {
				logger.error("定期清理失敗", { error });
			}
		}, this.CLEANUP_INTERVAL);
	}

	static stop(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
	}

	static cleanup(): void {
		CacheManager.clearCache();
		ImageLoader.clearCache();
		ResourceManager.clearPool();
	}
}

// 啟動定期清理和記憶體監控
CleanupManager.start();
MemoryMonitor.start();

// 錯誤處理工具類
class ErrorHandler {
	static async withRetry<T>(
		operation: () => Promise<T>,
		maxRetries: number = 3,
		delay: number = 1000
	): Promise<T | null> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError =
					error instanceof Error ? error : new Error(String(error));

				if (attempt < maxRetries) {
					logger.warn(
						`操作失敗，第 ${attempt} 次重試 (共 ${maxRetries} 次)`,
						{
							error: lastError,
							attempt,
							maxRetries
						}
					);
					await new Promise(resolve =>
						setTimeout(resolve, delay * attempt)
					);
				}
			}
		}

		logger.error(`操作在 ${maxRetries} 次嘗試後仍然失敗`, {
			error: lastError,
			maxRetries
		});
		return null;
	}

	static async safeExecute<T>(
		operation: () => Promise<T>,
		fallback: T | null = null,
		context?: string
	): Promise<T | null> {
		try {
			return await operation();
		} catch (error) {
			const errorMessage = context
				? `${context}: ${error}`
				: String(error);
			logger.error(errorMessage, { error });
			return fallback;
		}
	}

	static validateImageBuffer(buffer: Buffer | null): boolean {
		if (!buffer || buffer.length === 0) {
			return false;
		}

		// 檢查 PNG 標頭
		const pngHeader = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
		]);
		return buffer.subarray(0, 8).equals(pngHeader);
	}

	static async optimizeImageProcessing<T>(
		operations: (() => Promise<T>)[],
		batchSize: number = 5
	): Promise<T[]> {
		const results: T[] = [];

		for (let i = 0; i < operations.length; i += batchSize) {
			const batch = operations.slice(i, i + batchSize);
			const batchResults = await Promise.allSettled(
				batch.map(operation => operation())
			);

			batchResults.forEach(result => {
				if (result.status === "fulfilled") {
					results.push(result.value);
				}
			});

			// 批次間短暫延遲，避免過度佔用資源
			if (i + batchSize < operations.length) {
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		}

		return results;
	}
}

// 優化的緩存機制
class CacheManager {
	private static colorCache = new Map<
		string,
		{ color: string; timestamp: number }
	>();
	private static imageCache = new Map<
		string,
		{ image: any; timestamp: number }
	>();
	private static wikiImagesCache = new Map<
		string,
		{ images: any[]; timestamp: number }
	>();
	private static readonly CACHE_TTL = 5 * 60 * 1000; // 5分鐘
	private static readonly MAX_CACHE_SIZE = 1000;

	static getCachedColor(imgPath: string): string | null {
		const cached = this.colorCache.get(imgPath);
		if (!cached) return null;

		if (Date.now() - cached.timestamp > this.CACHE_TTL) {
			this.colorCache.delete(imgPath);
			return null;
		}
		return cached.color;
	}

	static setCachedColor(imgPath: string, color: string): void {
		// 防止緩存過大
		if (this.colorCache.size >= this.MAX_CACHE_SIZE) {
			const oldestKey = this.colorCache.keys().next().value;
			if (oldestKey !== undefined) {
				this.colorCache.delete(oldestKey);
			}
		}
		this.colorCache.set(imgPath, { color, timestamp: Date.now() });
	}

	static getCachedImage(key: string): any | null {
		const cached = this.imageCache.get(key);
		if (!cached) return null;

		if (Date.now() - cached.timestamp > this.CACHE_TTL) {
			this.imageCache.delete(key);
			return null;
		}
		return cached.image;
	}

	static setCachedImage(key: string, image: any): void {
		if (this.imageCache.size >= this.MAX_CACHE_SIZE) {
			const oldestKey = this.imageCache.keys().next().value;
			if (oldestKey !== undefined) {
				this.imageCache.delete(oldestKey);
			}
		}
		this.imageCache.set(key, { image, timestamp: Date.now() });
	}

	static getCachedWikiImages(characterName: string): any[] | null {
		const cached = this.wikiImagesCache.get(characterName);
		if (!cached) return null;

		if (Date.now() - cached.timestamp > this.CACHE_TTL) {
			this.wikiImagesCache.delete(characterName);
			return null;
		}
		return cached.images;
	}

	static setCachedWikiImages(characterName: string, images: any[]): void {
		if (this.wikiImagesCache.size >= this.MAX_CACHE_SIZE) {
			const oldestKey = this.wikiImagesCache.keys().next().value;
			if (oldestKey !== undefined) {
				this.wikiImagesCache.delete(oldestKey);
			}
		}
		this.wikiImagesCache.set(characterName, {
			images,
			timestamp: Date.now()
		});
	}

	static clearCache(): void {
		this.colorCache.clear();
		this.imageCache.clear();
		this.wikiImagesCache.clear();
	}

	static cleanup(): void {
		const now = Date.now();

		// 清理過期的顏色緩存
		for (const [key, value] of this.colorCache.entries()) {
			if (now - value.timestamp > this.CACHE_TTL) {
				this.colorCache.delete(key);
			}
		}

		// 清理過期的圖像緩存
		for (const [key, value] of this.imageCache.entries()) {
			if (now - value.timestamp > this.CACHE_TTL) {
				this.imageCache.delete(key);
			}
		}

		// 清理過期的Wiki圖片緩存
		for (const [key, value] of this.wikiImagesCache.entries()) {
			if (now - value.timestamp > this.CACHE_TTL) {
				this.wikiImagesCache.delete(key);
			}
		}
	}
}

// 優化的顏色提取函數
async function getMainColor(imgPath: string): Promise<string | null> {
	// 檢查緩存
	const cachedColor = CacheManager.getCachedColor(imgPath);
	if (cachedColor) {
		return cachedColor;
	}

	try {
		let finalPath = imgPath;

		// 如果是 WebP 格式，先轉換為 PNG
		if (imgPath.endsWith(".webp")) {
			const tmpPng = imgPath.replace(/\.webp$/, ".png");

			// 檢查 PNG 文件是否已存在
			try {
				await fs.access(tmpPng);
				finalPath = tmpPng;
			} catch {
				// PNG 文件不存在，需要轉換
				await webp.dwebp(imgPath, tmpPng, "-o");
				finalPath = tmpPng;
			}
		}

		// 使用 Vibrant 提取主要顏色
		const palette = await Vibrant.from(finalPath).getPalette();

		// 優先使用 Vibrant 顏色，如果沒有則使用其他顏色
		const vibrantColor =
			palette.Vibrant ||
			palette.DarkVibrant ||
			palette.LightVibrant ||
			palette.Muted;

		if (vibrantColor) {
			const rgb = vibrantColor.rgb;
			const hexColor = `#${rgb[0].toString(16).padStart(2, "0")}${rgb[1].toString(16).padStart(2, "0")}${rgb[2].toString(16).padStart(2, "0")}`;

			// 緩存結果
			CacheManager.setCachedColor(imgPath, hexColor);
			return hexColor;
		}

		return null;
	} catch (error) {
		logger.error(`顏色提取失敗: ${imgPath}`, { error });
		return null;
	}
}

// 配置常量
const CONFIG = {
	ASSETS_BASE_PATH: join("src", "assets", "images"),
	CARD: {
		PORTRAIT_SIZE: 300,
		WIDTH: 300,
		HEIGHT: 400,
		SPACING: 20,
		CARDS_PER_ROW: 12,
		RARITY_BG_HEIGHT: Math.round((93 * 300) / 160), // 約174px
		PADDING: 20 // 圖片邊距
	},
	ICON: {
		SIZE_X: 63 * 0.9,
		SIZE_Y: 72 * 0.9,
		PADDING: 10,
		JOB_SIZE: 120
	},
	FONT: {
		LEVEL_SIZE: 36,
		NAME_SIZE: 40,
		ELEMENT_SIZE: 12,
		COMBAT_LABEL: 22,
		COMBAT_VALUE: 30
	},
	COLORS: {
		BACKGROUND: "#1a1a1a",
		TEXT: "#ffffff",
		SHADOW: "rgba(0, 0, 0, 0.5)",
		RARITY_SSR: "#FFD700",
		RARITY_SR: "#9C27B0",
		RARITY_R: "#2196F3",
		STROKE: "#000000"
	},
	SHADOW: {
		BLUR: 10,
		OFFSET_X: 2,
		OFFSET_Y: 2
	},
	NAME_DISPLAY: {
		MAX_WIDTH: 280,
		MIN_FONT_SIZE: 20,
		MAX_FONT_SIZE: 40
	},
	STAR: {
		SIZE: 40,
		SPACING: 2.5
	}
} as const;

// 裝備介面
interface Equipment {
	arm_equip_corporation_type: number;
	arm_equip_lv: number;
	arm_equip_option1_id: number;
	arm_equip_option2_id: number;
	arm_equip_option3_id: number;
	arm_equip_tid: number;
	arm_equip_tier: number;
	head_equip_corporation_type: number;
	head_equip_lv: number;
	head_equip_option1_id: number;
	head_equip_option2_id: number;
	head_equip_option3_id: number;
	head_equip_tid: number;
	head_equip_tier: number;
	leg_equip_corporation_type: number;
	leg_equip_lv: number;
	leg_equip_option1_id: number;
	leg_equip_option2_id: number;
	leg_equip_option3_id: number;
	leg_equip_tid: number;
	leg_equip_tier: number;
	torso_equip_corporation_type: number;
	torso_equip_lv: number;
	torso_equip_option1_id: number;
	torso_equip_option2_id: number;
	torso_equip_option3_id: number;
	torso_equip_tid: number;
	torso_equip_tier: number;
}

// 技能介面
interface Skills {
	skill1_lv: number;
	skill2_lv: number;
	ulti_skill_lv: number;
}

// 狀態效果介面
interface StateEffect {
	function_details: Array<{
		buff: string;
		buff_icon: string;
		duration_type: string;
		duration_value: number;
		function_battlepower: number;
		function_standard: string;
		function_target: string;
		function_type: string;
		function_value: number;
		function_value_type: string;
		id: number;
		level: number;
		name_localvalues: string;
	}>;
	functions: number[];
	hurt_function_id_list: number[];
	icon: string;
	id: string;
	use_function_id_list: number[];
}

// 角色詳細資料介面
interface CharacterDetails {
	arena_combat: number;
	arena_harmony_cube_lv: number;
	arena_harmony_cube_tid: number;
	attractive_lv: number;
	combat: number;
	core: number;
	costume_tid: number;
	favorite_item_lv: number;
	favorite_item_tid: number;
	grade: number;
	harmony_cube_lv: number;
	harmony_cube_tid: number;
	lv: number;
	name_code: number;
}

// Character 接口已從 types/index.ts 導入

// 排序類型
type SortType = "combat" | "level" | "grade" | "rarity";

// 篩選類型
interface FilterOptions {
	classes: string[];
	corporations: string[];
	weaponTypes: string[];
	elements: string[];
}

// 映射表
const ELEMENT_MAP: Record<string, string> = {
	Fire: "fire",
	Water: "water",
	Wind: "wind",
	Iron: "iron",
	Electronic: "electronic"
};

const WEAPON_MAP: Record<string, string> = {
	AR: "assault_rifle",
	MG: "machine_gun",
	SMG: "sub_machine_gun",
	SG: "shot_gun",
	SR: "sniper_rifle",
	RL: "rocket_launcher"
};

const RARITY_COLOR_MAP: Record<string, string> = {
	SSR: "yellow",
	SR: "purple",
	R: "blue"
};

// 角色圖片下載管理類
class CharacterImageDownloader {
	private static readonly FB_PATH = join("src", "assets", "images", "fb");
	private static readonly DOTGG_BASE_URL =
		"https://static.dotgg.gg/nikke/characters/";
	private static readonly NIKKE_WIKI_API_BASE =
		"https://nikkevn.miraheze.org/w/api.php";

	static async ensureDirectoryExists(): Promise<void> {
		try {
			await fs.access(this.FB_PATH);
		} catch {
			await fs.mkdir(this.FB_PATH, { recursive: true });
		}
	}

	// 從 Nikke Wiki API 查詢角色圖片（優化版本）
	static async queryWikiImages(characterName: string): Promise<any[]> {
		// 檢查緩存
		const cachedImages = CacheManager.getCachedWikiImages(characterName);
		if (cachedImages) {
			return cachedImages;
		}

		try {
			const url = new URL(this.NIKKE_WIKI_API_BASE);
			url.searchParams.set("action", "query");
			url.searchParams.set("format", "json");
			url.searchParams.set("list", "allimages");
			url.searchParams.set("formatversion", "2");
			url.searchParams.set("aisort", "name");
			url.searchParams.set("aifrom", characterName);
			url.searchParams.set("aito", characterName + "z");
			url.searchParams.set("ailimit", "max");

			// 添加超時控制
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超時

			const response = await fetch(url.toString(), {
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				logger.warn(`Wiki API 請求失敗: ${response.status}`);
				return [];
			}

			const data = (await response.json()) as any;
			const images = data.query?.allimages || [];

			// 緩存結果
			CacheManager.setCachedWikiImages(characterName, images);
			return images;
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.warn(`Wiki API 查詢超時: ${characterName}`);
			} else {
				logger.error(`查詢 Wiki 圖片失敗: ${characterName}`, { error });
			}
			return [];
		}
	}

	// 從 Wiki 下載角色全身圖片（優化版本）
	static async downloadWikiImage(
		imageUrl: string,
		localPath: string
	): Promise<boolean> {
		try {
			// 添加超時控制
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超時

			const response = await fetch(imageUrl, {
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				logger.warn(`下載 Wiki 圖片失敗: ${response.status}`);
				return false;
			}

			const buffer = await response.arrayBuffer();
			await fs.writeFile(localPath, Buffer.from(buffer));

			return true;
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				logger.warn(`Wiki 圖片下載超時: ${imageUrl}`);
			} else {
				logger.error(`下載 Wiki 圖片失敗: ${imageUrl}`, { error });
			}
			return false;
		}
	}

	// 優化的並行下載多個圖片
	static async downloadMultipleImages(
		downloadTasks: Array<{ url: string; path: string }>
	): Promise<Array<{ success: boolean; path: string }>> {
		const BATCH_SIZE = 5; // 限制並發數量
		const results: Array<{ success: boolean; path: string }> = [];

		// 分批處理下載任務
		for (let i = 0; i < downloadTasks.length; i += BATCH_SIZE) {
			const batch = downloadTasks.slice(i, i + BATCH_SIZE);

			const batchResults = await Promise.allSettled(
				batch.map(async ({ url, path }) => {
					const success = await this.downloadWikiImage(url, path);
					return { success, path };
				})
			);

			batchResults.forEach((result, batchIndex) => {
				if (result.status === "fulfilled") {
					results.push(result.value);
				} else {
					const task = batch[batchIndex];
					if (task) {
						logger.error(`下載任務失敗: ${task.path}`, {
							error: result.reason
						});
						results.push({ success: false, path: task.path });
					} else {
						results.push({ success: false, path: "unknown" });
					}
				}
			});
		}

		return results;
	}

	// 下載角色全身圖片（優先從 Wiki 下載）
	static async downloadCharacterImage(
		resourceId: number,
		characterName?: string,
		costumeIndex?: number
	): Promise<string | null> {
		try {
			await this.ensureDirectoryExists();

			// 生成文件名
			const costumeSuffix =
				costumeIndex !== undefined
					? `_${costumeIndex.toString().padStart(2, "0")}`
					: "";
			const fileName = `c${resourceId.toString().padStart(3, "0")}${costumeSuffix}_00.png`;
			const localPath = join(this.FB_PATH, fileName);

			// 檢查本地文件是否存在
			try {
				await fs.access(localPath);
				return localPath;
			} catch {}

			// 如果有角色名稱，先嘗試從 Wiki 下載
			if (characterName) {
				const wikiImages = await this.queryWikiImages(characterName);

				// 查找對應的圖片
				let targetImage = null;
				let defaultImage = null;

				if (costumeIndex !== undefined) {
					// 查找皮膚圖片
					targetImage = wikiImages.find(img =>
						img.name.includes(
							`${characterName}_skin_${costumeIndex}`
						)
					);
					// 同時查找沒有皮膚的版本
					defaultImage = wikiImages.find(img =>
						img.name.includes(`${characterName}_full`)
					);
				} else {
					// 查找全身圖片
					targetImage = wikiImages.find(img =>
						img.name.includes(`${characterName}_full`)
					);
				}

				// 下載目標圖片
				if (targetImage && targetImage.url) {
					const success = await this.downloadWikiImage(
						targetImage.url,
						localPath
					);
					if (success) {
						// 如果有皮膚，並行下載所有相關版本
						if (costumeIndex !== undefined) {
							const downloadTasks: Array<{
								url: string;
								path: string;
							}> = [];

							// 準備默認版本下載任務
							if (defaultImage && defaultImage.url) {
								const defaultFileName = `c${resourceId.toString().padStart(3, "0")}_00.png`;
								const defaultLocalPath = join(
									this.FB_PATH,
									defaultFileName
								);

								try {
									await fs.access(defaultLocalPath);
								} catch {
									downloadTasks.push({
										url: defaultImage.url,
										path: defaultLocalPath
									});
								}
							}

							// 準備其他皮膚版本下載任務
							const skinImages = wikiImages.filter(
								img =>
									img.name.includes(
										`${characterName}_skin_`
									) &&
									!img.name.includes(
										`${characterName}_skin_${costumeIndex}`
									)
							);

							for (const skinImage of skinImages) {
								if (skinImage.url) {
									const skinMatch =
										skinImage.name.match(/_skin_(\d+)/);
									if (skinMatch) {
										const skinIndex = parseInt(
											skinMatch[1]
										);
										const skinFileName = `c${resourceId.toString().padStart(3, "0")}_${skinIndex.toString().padStart(2, "0")}_00.png`;
										const skinLocalPath = join(
											this.FB_PATH,
											skinFileName
										);

										try {
											await fs.access(skinLocalPath);
										} catch {
											downloadTasks.push({
												url: skinImage.url,
												path: skinLocalPath
											});
										}
									}
								}
							}

							// 並行下載所有任務
							if (downloadTasks.length > 0) {
								const results =
									await this.downloadMultipleImages(
										downloadTasks
									);
								const successCount = results.filter(
									r => r.success
								).length;
								logger.info(
									`並行下載完成: ${successCount}/${downloadTasks.length} 個文件成功`
								);
							}
						}
						return localPath;
					}
				}
			}

			// 如果 Wiki 下載失敗，回退到原始方法
			const webpFileName = `c${resourceId.toString().padStart(3, "0")}_00.webp`;
			const webpLocalPath = join(this.FB_PATH, webpFileName);
			const remoteUrl = `${this.DOTGG_BASE_URL}${webpFileName}`;

			const response = await fetch(remoteUrl);
			if (response.ok) {
				const buffer = await response.arrayBuffer();
				await fs.writeFile(webpLocalPath, Buffer.from(buffer));
				logger.info(`成功下載角色圖片: ${webpFileName}`);
				return webpLocalPath;
			}

			logger.warn(`無法下載角色圖片: ${remoteUrl} (${response.status})`);
			return null;
		} catch (error) {
			logger.error(`下載角色圖片失敗: ${resourceId}`, { error });
			return null;
		}
	}

	// 獲取角色圖片的主要顏色
	static async getCharacterMainColor(
		resourceId: number,
		characterName?: string,
		costumeIndex?: number
	): Promise<string | null> {
		try {
			// 先嘗試下載圖片
			const downloadedPath = await this.downloadCharacterImage(
				resourceId,
				characterName,
				costumeIndex
			);

			if (!downloadedPath) {
				return null;
			}

			// 提取主要顏色
			return await getMainColor(downloadedPath);
		} catch (error) {
			logger.error(`獲取角色主要顏色失敗: ${resourceId}`, { error });
			return null;
		}
	}
}

// 圖片路徑管理類
class ImagePathManager {
	private static readonly BASE_PATH = CONFIG.ASSETS_BASE_PATH;

	static getCharacterPortraitPath(
		resourceId: number,
		costumeIndex?: number
	): string {
		const costumeSuffix =
			costumeIndex !== undefined
				? `_${costumeIndex.toString().padStart(2, "0")}`
				: "";
		return join(
			this.BASE_PATH,
			`sprite/si_c${resourceId.toString().padStart(3, "0")}${costumeSuffix}_00_s.png`
		);
	}

	static getElementIconPath(element: string): string {
		return join(
			this.BASE_PATH,
			`icon-code-${ELEMENT_MAP[element] || element.toLowerCase()}.webp`
		);
	}

	static getWeaponIconPath(weaponType: string): string {
		return join(
			this.BASE_PATH,
			`icon-weapon-${WEAPON_MAP[weaponType] || weaponType.toLowerCase()}.webp`
		);
	}

	static getBurstSkillIconPath(burstSkill: string): string {
		return join(this.BASE_PATH, `${burstSkill.toLowerCase()}.webp`);
	}

	static getIconBgPath(): string {
		return join(this.BASE_PATH, "icon-bg.webp");
	}

	static getRarityBgPath(rarity: string): string {
		return join(this.BASE_PATH, `${rarity}.webp`);
	}

	static getJobIconPath(classType: string, rarity: string): string {
		const color = RARITY_COLOR_MAP[rarity] || "blue";
		return join(
			this.BASE_PATH,
			`nikke-job-${classType.toLowerCase()}--${color}.webp`
		);
	}

	static getStarIconPath(isGold: boolean = false): string {
		const starType = isGold ? "gold" : "";
		return join(
			this.BASE_PATH,
			`icon-nikke-star${starType ? `-${starType}` : ""}.webp`
		);
	}

	static getCoreIconPath(): string {
		return join(this.BASE_PATH, "core.webp");
	}

	static getRarityImagePath(rarity: string): string {
		return join(this.BASE_PATH, `${rarity}.png`);
	}

	static getJobImagePath(jobClass: string): string {
		return join(this.BASE_PATH, `${jobClass.toLowerCase()}.webp`);
	}

	static getCompanyImagePath(company: string): string {
		return join(this.BASE_PATH, `${company.toLowerCase()}.webp`);
	}

	static getIconBgEmptyPath(): string {
		return join(this.BASE_PATH, "icon-bg-empty.webp");
	}

	static getRankImagePath(): string {
		return join(this.BASE_PATH, "rank.webp");
	}

	static getFavoriteItemImagePath(weaponType: string): string {
		return join(
			this.BASE_PATH,
			`/favorite_item/${weaponType.toLowerCase()}.webp`
		);
	}

	static getHarmonyCubeImagePath(cubeId: number): string {
		return join(this.BASE_PATH, `/cube/${cubeId}.webp`);
	}

	static getEquipmentImagePath(
		partKey: string,
		characterClass: string,
		tier: number
	): string {
		// 部位映射: arm -> a, head -> h, torso -> t, leg -> l
		const partMap: Record<string, string> = {
			arm: "arm",
			head: "head",
			torso: "body",
			leg: "leg"
		};

		// 職業映射: Attacker -> a, Defender -> d, Supporter -> s
		const classMap: Record<string, string> = {
			Attacker: "attacker",
			Defender: "defender",
			Supporter: "supporter"
		};

		// 階級映射: 1~2->1, 3~4->3, 5~6->5, 7~8->7, 9->9, 10->10
		let tierLevel: string;
		if (tier >= 1 && tier <= 2) {
			tierLevel = "1";
		} else if (tier >= 3 && tier <= 4) {
			tierLevel = "3";
		} else if (tier >= 5 && tier <= 6) {
			tierLevel = "5";
		} else if (tier >= 7 && tier <= 8) {
			tierLevel = "7";
		} else if (tier === 9) {
			tierLevel = "9";
		} else if (tier === 10) {
			tierLevel = "10";
		} else {
			tierLevel = "1"; // 默认
		}

		const partCode = partMap[partKey] || "arm";
		const classCode = classMap[characterClass] || "attacker";

		return join(
			this.BASE_PATH,
			`gear/icn_equipment_${partCode}_${classCode}_t${tierLevel}.webp`
		);
	}

	static getStarSvgPath(): string {
		return join(this.BASE_PATH, "star.svg");
	}

	static getCompanyIconPath(corporationType: number): string {
		// 公司類型映射
		const companyMap: Record<number, string> = {
			5: "abnormal",
			4: "pilgrim",
			3: "tetra",
			2: "missilis",
			1: "elysion"
		};

		const companyName = companyMap[corporationType] || "elysion";
		return join(this.BASE_PATH, `${companyName}.webp`);
	}
}

// 根據 costume_id 查找對應的 costume_index
const getCostumeIndex = (
	nameCode: number,
	costumeId: number
): number | null => {
	const character = characters.find(
		(char: any) => char.name_code === nameCode
	);
	if (!character || !character.costumes) {
		return null;
	}

	const costume = character.costumes.find(
		(costume: any) => costume.id === costumeId
	);
	return costume ? costume.costume_index : null;
};

// 根據 name_code 獲取英文角色名稱
const getCharacterEnName = (nameCode: number): string | null => {
	const character = charactersEn.find(
		(char: any) => char.name_code === nameCode
	);
	return character ? character.name_localkey.name : null;
};

// 根據收藏品 tid 獲取品級
const getFavoriteItemRarity = (tid: number): string => {
	if (tid === 0) return "";

	// 獲取第一個數字和最後一個數字
	const tidStr = tid.toString();
	const firstDigit = tidStr.length > 0 ? parseInt(tidStr[0]!) : 0;
	const lastDigit = tid % 10;

	// SSR: 第一個字是 2
	if (firstDigit === 2) {
		return "SSR";
	}
	// SR: 第一個字是 1 最後一個字是 2
	else if (firstDigit === 1 && lastDigit === 2) {
		return "SR";
	}
	// R: 第一個字是 1 最後一個字是 1
	else if (firstDigit === 1 && lastDigit === 1) {
		return "R";
	} else {
		return "R"; // 預設為 R
	}
};

// 裝備效果映射表
const EQUIPMENT_EFFECT_MAP: Record<string, string> = {
	"05": "優越代碼傷害增加",
	"06": "命中率增加",
	"07": "最大裝彈數增加",
	"08": "攻擊力增加",
	"09": "蓄力傷害增加",
	"10": "蓄力速度增加",
	"11": "暴擊率增加",
	"12": "暴擊傷害增加",
	"13": "防禦力增加"
};

// 裝備效果數值表
const EQUIPMENT_EFFECT_VALUES: Record<string, number[]> = {
	"05": [
		9.54, 10.94, 12.34, 13.75, 15.15, 16.55, 17.95, 19.35, 20.75, 22.15,
		23.56, 24.96, 26.36, 27.76, 29.16
	],
	"06": [
		4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.0, 9.7, 10.4, 11.11, 11.81, 12.52,
		13.22, 13.93, 14.63
	],
	"07": [
		27.84, 31.95, 36.06, 40.17, 44.28, 48.39, 52.5, 56.6, 60.71, 64.82,
		68.93, 73.04, 77.15, 81.26, 85.37
	],
	"08": [
		4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.0, 9.7, 10.4, 11.11, 11.81, 12.52,
		13.22, 13.93, 14.63
	],
	"09": [
		4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.0, 9.7, 10.4, 11.11, 11.81, 12.52,
		13.22, 13.93, 14.63
	],
	"10": [
		1.98, 2.28, 2.57, 2.86, 3.16, 3.45, 3.75, 4.04, 4.33, 4.63, 4.92, 5.21,
		5.51, 5.8, 6.09
	],
	"11": [
		2.3, 2.64, 2.98, 3.32, 3.66, 4.0, 4.35, 4.69, 5.03, 5.37, 5.7, 6.05,
		6.39, 6.73, 7.07
	],
	"12": [
		6.64, 7.62, 8.6, 9.58, 10.56, 11.54, 12.52, 13.5, 14.48, 15.46, 16.44,
		17.42, 18.4, 19.38, 20.36
	],
	"13": [
		4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.0, 9.7, 10.4, 11.11, 11.81, 12.52,
		13.22, 13.93, 14.63
	]
};

// 解析裝備效果ID
const parseEquipmentEffect = (
	effectId: number
): { name: string; value: number; level: number } | null => {
	if (effectId === 0) return null;

	const effectStr = effectId.toString();
	if (effectStr.length < 5) return null;

	// 提取效果類型（第4-5位）和等級（第6-7位）
	const effectType = effectStr.substring(3, 5);
	const levelStr = effectStr.substring(5);
	const level = parseInt(levelStr);

	const effectName = EQUIPMENT_EFFECT_MAP[effectType];
	const effectValues = EQUIPMENT_EFFECT_VALUES[effectType];

	if (
		!effectName ||
		!effectValues ||
		level < 1 ||
		level > effectValues.length
	) {
		return null;
	}

	const value = effectValues[level - 1] || 0; // 等級是1-based，數組是0-based

	return {
		name: effectName,
		value: value,
		level: level
	};
};

// 優化的圖片加載器
class ImageLoader {
	private static readonly MAX_CACHE_SIZE = 500;
	private static readonly CACHE_TTL = 10 * 60 * 1000; // 10分鐘
	private static imageCache = new Map<
		string,
		{ image: any; timestamp: number }
	>();
	private static loadingPromises = new Map<string, Promise<any>>();

	static async loadImage(path: string): Promise<any> {
		const cacheKey = path;

		// 檢查緩存
		const cachedImage = CacheManager.getCachedImage(cacheKey);
		if (cachedImage) {
			return cachedImage;
		}

		// 檢查是否正在載入
		if (this.loadingPromises.has(path)) {
			return await this.loadingPromises.get(path);
		}

		// 開始載入
		const loadPromise = this._loadImageInternal(path);
		this.loadingPromises.set(path, loadPromise);

		try {
			const image = await loadPromise;
			return image;
		} finally {
			this.loadingPromises.delete(path);
		}
	}

	private static async _loadImageInternal(path: string): Promise<any> {
		try {
			const image = await loadImage(path);
			CacheManager.setCachedImage(path, image);
			return image;
		} catch (error) {
			logger.warn(`無法加載圖片: ${path}`, { error });
			return null;
		}
	}

	static async loadMultipleImages(
		paths: string[]
	): Promise<Map<string, any>> {
		const imageMap = new Map<string, any>();

		// 批量處理，限制並發數量
		const BATCH_SIZE = 10;
		const batches: string[][] = [];

		for (let i = 0; i < paths.length; i += BATCH_SIZE) {
			batches.push(paths.slice(i, i + BATCH_SIZE));
		}

		for (const batch of batches) {
			const loadPromises = batch.map(async path => {
				const image = await this.loadImage(path);
				if (image) {
					imageMap.set(path, image);
				}
			});

			await Promise.allSettled(loadPromises);
		}

		return imageMap;
	}

	static cleanup(): void {
		const now = Date.now();
		for (const [key, value] of this.imageCache.entries()) {
			if (now - value.timestamp > this.CACHE_TTL) {
				this.imageCache.delete(key);
			}
		}
	}

	static clearCache(): void {
		this.imageCache.clear();
		this.loadingPromises.clear();
	}
}

// 資源管理器
class ResourceManager {
	private static canvasPool: any[] = [];
	private static readonly MAX_POOL_SIZE = 10;

	static createCanvas(width: number, height: number): any {
		// 嘗試從池中重用 Canvas
		if (this.canvasPool.length > 0) {
			const canvas = this.canvasPool.pop();
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			ctx.clearRect(0, 0, width, height);
			return canvas;
		}

		// 創建新的 Canvas
		return createCanvas(width, height);
	}

	static releaseCanvas(canvas: any): void {
		if (this.canvasPool.length < this.MAX_POOL_SIZE) {
			// 清理 Canvas
			const ctx = canvas.getContext("2d");
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			this.canvasPool.push(canvas);
		}
	}

	static clearPool(): void {
		this.canvasPool.length = 0;
	}
}

// 繪製工具類（優化版本）
class DrawingUtils {
	static applyTextShadow(ctx: CanvasRenderingContext2D): void {
		ctx.shadowColor = CONFIG.COLORS.SHADOW;
		ctx.shadowBlur = CONFIG.SHADOW.BLUR;
		ctx.shadowOffsetX = CONFIG.SHADOW.OFFSET_X;
		ctx.shadowOffsetY = CONFIG.SHADOW.OFFSET_Y;
	}

	static clearTextShadow(ctx: CanvasRenderingContext2D): void {
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
	}

	static drawTextWithStroke(
		ctx: any,
		text: string,
		x: number,
		y: number,
		font: string,
		fillColor: string = CONFIG.COLORS.TEXT,
		strokeColor: string = CONFIG.COLORS.STROKE,
		lineWidth: number = 3
	): void {
		ctx.font = font;
		ctx.textAlign = "right";
		ctx.strokeStyle = strokeColor;
		ctx.lineWidth = lineWidth;
		ctx.strokeText(text, x, y);
		ctx.fillStyle = fillColor;
		ctx.fillText(text, x, y);
	}

	// 優化的文字繪製函數
	static drawOptimizedText(
		ctx: any,
		text: string,
		x: number,
		y: number,
		fontSize: number,
		fontWeight: string = "normal",
		color: string = CONFIG.COLORS.TEXT,
		align: "left" | "center" | "right" = "left"
	): void {
		ctx.font = getFontString(fontSize, fontWeight, text);
		ctx.fillStyle = color;
		ctx.textAlign = align;
		ctx.fillText(text, x, y);
	}

	// 繪製圓角矩形
	static drawRoundedRect(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		radius: number
	): void {
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.lineTo(x + width - radius, y);
		ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
		ctx.lineTo(x + width, y + height - radius);
		ctx.quadraticCurveTo(
			x + width,
			y + height,
			x + width - radius,
			y + height
		);
		ctx.lineTo(x + radius, y + height);
		ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
		ctx.lineTo(x, y + radius);
		ctx.quadraticCurveTo(x, y, x + radius, y);
		ctx.closePath();
	}

	// 繪製 Liquid Glass 效果的圓角矩形
	static drawLiquidGlassRect(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		radius: number = 20,
		accentColor: string = "#4A90E2"
	): void {
		// 創建玻璃背景漸層
		const glassGradient = ctx.createLinearGradient(x, y, x, y + height);
		glassGradient.addColorStop(0, "rgba(255, 255, 255, 0.15)");
		glassGradient.addColorStop(0.5, "rgba(255, 255, 255, 0.08)");
		glassGradient.addColorStop(1, "rgba(255, 255, 255, 0.05)");

		// 繪製主要玻璃背景
		this.drawRoundedRect(ctx, x, y, width, height, radius);
		ctx.fillStyle = glassGradient;
		ctx.fill();

		// 添加背景模糊效果（使用半透明黑色）
		ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
		ctx.fill();

		// 繪製頂部高光
		const topHighlight = ctx.createLinearGradient(
			x,
			y,
			x,
			y + height * 0.3
		);
		topHighlight.addColorStop(0, "rgba(255, 255, 255, 0.25)");
		topHighlight.addColorStop(1, "rgba(255, 255, 255, 0)");

		this.drawRoundedRect(ctx, x, y, width, height * 0.3, radius);
		ctx.fillStyle = topHighlight;
		ctx.fill();

		// 繪製邊框漸層
		const borderGradient = ctx.createLinearGradient(x, y, x, y + height);
		borderGradient.addColorStop(0, "rgba(255, 255, 255, 0.3)");
		borderGradient.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
		borderGradient.addColorStop(1, "rgba(255, 255, 255, 0.2)");

		this.drawRoundedRect(ctx, x, y, width, height, radius);
		ctx.strokeStyle = borderGradient;
		ctx.lineWidth = 1.5;
		ctx.stroke();

		// 繪製頂部裝飾條（accent color）
		const accentGradient = ctx.createLinearGradient(x, y, x + width, y);
		// 確保顏色格式正確並添加透明度
		const normalizedColor = this.normalizeColor(accentColor);
		accentGradient.addColorStop(
			0,
			this.addAlphaToColor(normalizedColor, 0.5)
		);
		accentGradient.addColorStop(
			0.5,
			this.addAlphaToColor(normalizedColor, 1.0)
		);
		accentGradient.addColorStop(
			1,
			this.addAlphaToColor(normalizedColor, 0.5)
		);

		// 繪製頂部裝飾條，只在頂部有圓角
		ctx.save();
		this.drawRoundedRect(ctx, x, y, width, height, radius);
		ctx.clip();

		// 繪製裝飾條矩形
		ctx.fillStyle = accentGradient;
		ctx.fillRect(x, y, width, 4);

		ctx.restore();

		// 添加內部光澤效果
		const innerGlow = ctx.createRadialGradient(
			x + width * 0.3,
			y + height * 0.2,
			0,
			x + width * 0.3,
			y + height * 0.2,
			width * 0.8
		);
		innerGlow.addColorStop(0, "rgba(255, 255, 255, 0.1)");
		innerGlow.addColorStop(1, "rgba(255, 255, 255, 0)");

		ctx.save();
		this.drawRoundedRect(ctx, x, y, width, height, radius);
		ctx.clip();
		ctx.fillStyle = innerGlow;
		ctx.fillRect(x, y, width, height);
		ctx.restore();
	}

	// 標準化顏色格式為 hex
	static normalizeColor(color: string): string {
		// 如果已經是 hex 格式，直接返回
		if (
			color.startsWith("#") &&
			(color.length === 7 || color.length === 9)
		) {
			return color.length === 9 ? color.substring(0, 7) : color; // 移除現有的透明度
		}

		// 如果是預設顏色名稱，轉換為 hex
		const colorMap: Record<string, string> = {
			red: "#FF0000",
			green: "#00FF00",
			blue: "#0000FF",
			yellow: "#FFFF00",
			purple: "#800080",
			orange: "#FFA500",
			pink: "#FFC0CB",
			cyan: "#00FFFF",
			magenta: "#FF00FF",
			lime: "#00FF00",
			indigo: "#4B0082",
			violet: "#8A2BE2",
			brown: "#A52A2A",
			gray: "#808080",
			grey: "#808080",
			black: "#000000",
			white: "#FFFFFF"
		};

		const lowerColor = color.toLowerCase();
		if (colorMap[lowerColor]) {
			return colorMap[lowerColor];
		}

		// 如果無法識別，返回預設藍色
		return "#4A90E2";
	}

	// 為顏色添加透明度
	static addAlphaToColor(hexColor: string, alpha: number): string {
		// 確保 alpha 在 0-1 範圍內
		alpha = Math.max(0, Math.min(1, alpha));

		// 移除 # 符號
		const color = hexColor.replace("#", "");

		// 轉換為 RGB
		const r = parseInt(color.substring(0, 2), 16);
		const g = parseInt(color.substring(2, 4), 16);
		const b = parseInt(color.substring(4, 6), 16);

		// 返回 rgba 格式
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// 繪製資訊區塊
	static drawInfoBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		content: string[],
		accentColor: string = "#4A90E2"
	): number {
		const padding = 20;
		const titleHeight = 40;
		const lineHeight = 30;
		const borderRadius = 20;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 繪製內容
		let currentY = y + 15 + titleHeight + 20;
		ctx.font = getFontString(20, "normal", "content");
		ctx.fillStyle = "rgba(255, 255, 255, 0.95)";

		for (const line of content) {
			ctx.fillText(line, x + padding + 15, currentY);
			currentY += lineHeight;
		}

		return currentY + padding;
	}

	// 繪製帶圖片的資訊區塊
	static drawInfoBlockWithIcons(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		items: Array<{ text: string; icon?: any }>,
		accentColor: string = "#4A90E2"
	): number {
		const padding = 20;
		const titleHeight = 40;
		const lineHeight = 40; // 增加行高以容納圖片
		const borderRadius = 20;
		const iconSize = 24;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 繪製內容
		let currentY = y + 15 + titleHeight + 20;
		ctx.font = getFontString(18, "normal", "content");
		ctx.fillStyle = "rgba(255, 255, 255, 0.95)";

		for (const item of items) {
			const contentX = x + padding + 15;

			if (item.icon) {
				// 繪製圖片
				ctx.drawImage(
					item.icon,
					contentX,
					currentY - iconSize / 2 - 4,
					iconSize,
					iconSize
				);
				// 繪製文字（圖片右側）
				ctx.fillText(item.text, contentX + iconSize + 8, currentY);
			} else {
				// 只繪製文字
				ctx.fillText(item.text, contentX, currentY);
			}
			currentY += lineHeight;
		}

		return currentY + padding;
	}

	// 繪製基本屬性圖示區塊（只有圖片，無文字）
	static drawBasicAttributesBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		icons: {
			element?: any;
			weapon?: any;
			job?: any;
			company?: any;
			burst?: any;
			iconBg?: any;
			iconBgEmpty?: any;
		},
		accentColor: string = "#4A90E2"
	): number {
		const padding = 10;
		const titleHeight = 40;
		const borderRadius = 20;
		const iconWidth = 63;
		const iconHeight = 73;
		const iconSpacing = 40;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 計算圖示佈局
		const contentStartY = y + 15 + titleHeight + 20;
		const contentCenterX = x + width / 2;

		// 上排三個圖示（元素、武器、職業）
		const topRowY = contentStartY - 10;
		const topRowSpacing = iconWidth + iconSpacing;
		const topRowStartX =
			contentCenterX - (topRowSpacing * 3 - iconSpacing) / 2;

		// 元素圖示（不使用背景）
		if (icons.element) {
			ctx.drawImage(
				icons.element,
				topRowStartX,
				topRowY,
				iconWidth,
				iconHeight
			);
		}

		// 武器圖示（使用背景）
		if (icons.weapon && icons.iconBg) {
			const weaponX = topRowStartX + topRowSpacing;
			ctx.drawImage(
				icons.iconBg,
				weaponX,
				topRowY,
				iconWidth,
				iconHeight
			);
			const weaponIconWidth = iconWidth * 0.8;
			const weaponIconHeight = iconHeight * 0.8;
			const weaponIconOffsetX = iconWidth * 0.1;
			const weaponIconOffsetY = iconHeight * 0.1;
			ctx.drawImage(
				icons.weapon,
				weaponX + weaponIconOffsetX,
				topRowY + weaponIconOffsetY,
				weaponIconWidth,
				weaponIconHeight
			);
		}

		// 職業圖示（使用空背景）
		if (icons.job && icons.iconBgEmpty) {
			const jobX = topRowStartX + topRowSpacing * 2;
			ctx.drawImage(
				icons.iconBgEmpty,
				jobX,
				topRowY,
				iconWidth,
				iconHeight
			);
			const jobIconWidth = iconWidth * 0.8;
			const jobIconHeight = iconHeight * 0.8;
			const jobIconOffsetX = iconWidth * 0.1;
			const jobIconOffsetY = iconHeight * 0.1;
			ctx.drawImage(
				icons.job,
				jobX + jobIconOffsetX,
				topRowY + jobIconOffsetY,
				jobIconWidth,
				jobIconHeight
			);
		}

		// 下排兩個圖示（公司、爆裂）
		const bottomRowY = topRowY + iconHeight * 0.8;
		const bottomRowStartX =
			contentCenterX - (topRowSpacing * 2 - iconSpacing) / 2;

		// 公司圖示（使用空背景）
		if (icons.company && icons.iconBgEmpty) {
			const companyX = bottomRowStartX;
			ctx.drawImage(
				icons.iconBgEmpty,
				companyX,
				bottomRowY,
				iconWidth,
				iconHeight
			);
			const companyIconWidth = iconWidth * 0.8;
			const companyIconHeight = iconHeight * 0.8;
			const companyIconOffsetX = iconWidth * 0.1;
			const companyIconOffsetY = iconHeight * 0.1;
			ctx.drawImage(
				icons.company,
				companyX + companyIconOffsetX,
				bottomRowY + companyIconOffsetY,
				companyIconWidth,
				companyIconHeight
			);
		}

		// 爆裂技能圖示（使用背景）
		if (icons.burst && icons.iconBg) {
			const burstX = bottomRowStartX + topRowSpacing;
			ctx.drawImage(
				icons.iconBg,
				burstX,
				bottomRowY,
				iconWidth,
				iconHeight
			);
			const burstIconWidth = iconWidth * 0.8;
			const burstIconHeight = iconHeight * 0.8;
			const burstIconOffsetX = iconWidth * 0.1;
			const burstIconOffsetY = iconHeight * 0.1;
			ctx.drawImage(
				icons.burst,
				burstX + burstIconOffsetX,
				bottomRowY + burstIconOffsetY,
				burstIconWidth,
				burstIconHeight
			);
		}

		return y + height;
	}

	// 繪製圓形技能圖示
	static drawCircularSkill(
		ctx: any,
		x: number,
		y: number,
		skillLevel: number,
		skillLabel: string,
		skillIcon?: any
	): void {
		const mainRadius = 47; // 減小3px，從50變成47
		const smallRadius = 20.68; // 按比例縮小 22 * (47/50) = 20.68
		const borderWidth = 4; // 0.25rem = 4px
		const smallBorderWidth = 2; // 0.125rem = 2px

		// 繪製主圓形背景
		ctx.beginPath();
		ctx.arc(x + mainRadius, y + mainRadius, mainRadius, 0, 2 * Math.PI);
		ctx.fillStyle = "#3f4044";
		ctx.fill();

		// 繪製主圓形白色邊框
		ctx.beginPath();
		ctx.arc(x + mainRadius, y + mainRadius, mainRadius, 0, 2 * Math.PI);
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = borderWidth;
		ctx.stroke();

		// 繪製主圓形外層陰影
		ctx.beginPath();
		ctx.arc(
			x + mainRadius,
			y + mainRadius,
			mainRadius + borderWidth + 1,
			0,
			2 * Math.PI
		);
		ctx.strokeStyle = "rgba(63, 64, 68, 0.4)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 在主圓形中心繪製技能標籤文字
		ctx.font = getFontString(14, "bold", skillLabel);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(skillLabel, x + mainRadius, y + mainRadius);

		// 如果有技能圖示，繪製在主圓形中心（在文字上方）
		if (skillIcon) {
			const iconSize = mainRadius * 0.8;
			const iconX = x + mainRadius - iconSize / 2;
			const iconY = y + mainRadius - iconSize / 2 - 10; // 稍微上移避免與文字重疊
			ctx.drawImage(skillIcon, iconX, iconY, iconSize, iconSize);
		}

		// 計算小圓形位置（Y與大圓形一樣，X往右一些）
		const smallX = x + mainRadius + smallRadius - 3;
		const smallY = y + mainRadius + smallRadius / 2;

		// 繪製小圓形背景
		ctx.beginPath();
		ctx.arc(
			smallX + smallRadius,
			smallY + smallRadius,
			smallRadius,
			0,
			2 * Math.PI
		);
		ctx.fillStyle = "#3f4044";
		ctx.fill();

		// 繪製小圓形白色邊框
		ctx.beginPath();
		ctx.arc(
			smallX + smallRadius,
			smallY + smallRadius,
			smallRadius,
			0,
			2 * Math.PI
		);
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = smallBorderWidth;
		ctx.stroke();

		// 繪製小圓形外層陰影
		ctx.beginPath();
		ctx.arc(
			smallX + smallRadius,
			smallY + smallRadius,
			smallRadius + smallBorderWidth + 1,
			0,
			2 * Math.PI
		);
		ctx.strokeStyle = "rgba(63, 64, 68, 0.4)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 在小圓形中繪製技能等級
		ctx.font = getFontString(22, "bold", skillLevel.toString());
		ctx.fillStyle = "#12a8fe";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(
			skillLevel.toString(),
			smallX + smallRadius,
			smallY + smallRadius
		);
	}

	// 繪製技能等級區塊（三個一橫排）
	static drawSkillsBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		skills: { skill1_lv: number; skill2_lv: number; ulti_skill_lv: number },
		accentColor: string = "#4A90E2"
	): number {
		const padding = 20;
		const titleHeight = 40;
		const borderRadius = 20;
		const skillSize = 94; // 主圓形直徑，減小6px (半徑減小3px)
		const skillSpacing = 20;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 計算技能圓形的起始位置
		const contentStartY = y + 15 + titleHeight + 30;
		const totalSkillsWidth = 3 * skillSize + 2 * skillSpacing;
		const skillsStartX = x + (width - totalSkillsWidth) / 2;

		// 繪製三個技能圓形
		this.drawCircularSkill(
			ctx,
			skillsStartX,
			contentStartY,
			skills.skill1_lv,
			"技能1"
		);
		this.drawCircularSkill(
			ctx,
			skillsStartX + skillSize + skillSpacing,
			contentStartY,
			skills.skill2_lv,
			"技能2"
		);
		this.drawCircularSkill(
			ctx,
			skillsStartX + 2 * (skillSize + skillSpacing),
			contentStartY,
			skills.ulti_skill_lv,
			"爆裂技"
		);

		return y + height;
	}

	// 繪製戰鬥數據區塊（與全部角色頁面相同的樣式）
	static async drawCombatDataBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		character: any,
		accentColor: string = "#4A90E2"
	): Promise<number> {
		const padding = 20;
		const titleHeight = 40;
		const borderRadius = 20;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 計算內容區域
		const contentStartY = y + 15 + titleHeight + 20;
		const contentX = x + padding + 15;

		// 繪製戰鬥力部分（右側）
		if (character.combat !== undefined) {
			const combatY = contentStartY + 30;
			const combatX = x + width - padding - 15;

			// 先繪製戰鬥力數字（較大字體）
			const combatText = character.combat.toLocaleString();
			ctx.font = getFontString(32, "bold", combatText);
			ctx.fillStyle = "#FFFFFF";
			ctx.textAlign = "right";
			ctx.strokeStyle = "#000000";
			ctx.lineWidth = 3;
			ctx.strokeText(combatText, combatX, combatY);
			ctx.fillText(combatText, combatX, combatY);

			// 計算數字寬度，然後在左側繪製「戰鬥力」文字
			const combatTextWidth = ctx.measureText(combatText).width;
			const labelX = combatX - combatTextWidth - 7.5;

			// 繪製「戰鬥力」文字（較小字體）
			ctx.font = getFontString(20, "bold", "戰鬥力");
			ctx.fillStyle = "#FFFFFF";
			ctx.textAlign = "right";
			ctx.strokeStyle = "#000000";
			ctx.lineWidth = 2;
			ctx.strokeText("戰鬥力", labelX, combatY);
			ctx.fillText("戰鬥力", labelX, combatY);

			// 繪製魅力等級（rank 圖片，在戰鬥力下方）
			if (
				character.details &&
				character.details.attractive_lv !== undefined
			) {
				const rankSize = 50;
				const rankX = labelX;
				const rankY = combatY + 20;
				const rankImage = await loadImage(
					ImagePathManager.getRankImagePath()
				);
				ctx.drawImage(rankImage, rankX, rankY, rankSize, rankSize);

				// 在 rank 圖片中心繪製白色魅力等級數字
				ctx.font = "bold 28px 'Deco'";
				ctx.fillStyle = "#FFFFFF";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.strokeStyle = "#000000";
				ctx.lineWidth = 1;
				ctx.strokeText(
					character.details.attractive_lv.toString(),
					rankX + rankSize / 2,
					rankY + rankSize / 2
				);
				ctx.fillText(
					character.details.attractive_lv.toString(),
					rankX + rankSize / 2,
					rankY + rankSize / 2
				);
			}
		}

		// 繪製等級部分（左側，往下移動使用更大字體）
		if (character.lv !== undefined) {
			// 繪製等級數字（更大字體）
			const levelText = character.lv.toString();
			ctx.font = "bold 60px 'Deco'";
			ctx.fillStyle = "#FFFFFF";
			ctx.textAlign = "left";
			ctx.strokeStyle = "#000000";
			ctx.lineWidth = 3;
			ctx.strokeText(levelText, contentX, contentStartY + 75); // 往下移動 10px
			ctx.fillText(levelText, contentX, contentStartY + 75);

			// 繪製 LV. 文字（在數字上方）
			ctx.font = "bold 32px 'Deco'";
			const levelTextWidth = ctx.measureText(levelText).width;
			const lvX = contentX + levelTextWidth / 2;
			const lvY = contentStartY + 20; // 稍微往下調整
			ctx.strokeText("LV.", lvX, lvY);
			ctx.fillText("LV.", lvX, lvY);
		}

		return y + height;
	}

	// 繪製收藏品和魔方區塊（兩個一排）
	static async drawCollectionBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		character: any,
		accentColor: string = "#4A90E2"
	): Promise<number> {
		const padding = 20;
		const titleHeight = 40;
		const borderRadius = 20;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 計算內容區域
		const contentStartY = y + 15 + titleHeight + 30;
		const contentX = x + padding + 15;
		const itemSpacing = 30;
		const itemSize = 60;

		// 繪製收藏品（左側）
		if (character.details && character.details.favorite_item_tid !== 0) {
			try {
				const weaponType = character.shot_id.element.weapon_type;
				const favoriteItemImage = await loadImage(
					ImagePathManager.getFavoriteItemImagePath(weaponType)
				);

				const favoriteX = contentX;
				const favoriteY = contentStartY;

				// 繪製收藏品圖片
				ctx.drawImage(
					favoriteItemImage,
					favoriteX,
					favoriteY,
					itemSize,
					itemSize
				);

				// 繪製收藏品等級文字
				ctx.font = getFontString(
					16,
					"bold",
					`Lv.${character.details.favorite_item_lv}`
				);
				ctx.fillStyle = "#FFFFFF";
				ctx.textAlign = "center";
				ctx.strokeStyle = "#000000";
				ctx.lineWidth = 1;
				ctx.strokeText(
					`Lv.${character.details.favorite_item_lv}`,
					favoriteX + itemSize / 2,
					favoriteY + itemSize + 20
				);
				ctx.fillText(
					`Lv.${character.details.favorite_item_lv}`,
					favoriteX + itemSize / 2,
					favoriteY + itemSize + 20
				);

				// 繪製「收藏品」標籤
				ctx.font = getFontString(14, "normal", "收藏品");
				ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
				ctx.strokeText(
					"收藏品",
					favoriteX + itemSize / 2,
					favoriteY - 10
				);
				ctx.fillText(
					"收藏品",
					favoriteX + itemSize / 2,
					favoriteY - 10
				);
			} catch (error) {
				// 如果圖片載入失敗，顯示文字
				ctx.font = getFontString(
					16,
					"normal",
					`收藏品: Lv.${character.details.favorite_item_lv}`
				);
				ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
				ctx.textAlign = "left";
				ctx.fillText(
					`收藏品: Lv.${character.details.favorite_item_lv}`,
					contentX,
					contentStartY + 20
				);
			}
		}

		// 繪製魔方（右側）
		if (
			character.details &&
			character.details.harmony_cube_lv !== undefined
		) {
			const cubeX = contentX + itemSize + itemSpacing + 30;
			const cubeY = contentStartY;

			// 繪製魔方背景圓形
			ctx.beginPath();
			ctx.arc(
				cubeX + itemSize / 2,
				cubeY + itemSize / 2,
				itemSize / 2,
				0,
				2 * Math.PI
			);
			ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
			ctx.fill();
			ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
			ctx.lineWidth = 2;
			ctx.stroke();

			// 繪製魔方等級文字
			ctx.font = getFontString(
				18,
				"bold",
				`Lv.${character.details.harmony_cube_lv}`
			);
			ctx.fillStyle = "#FFFFFF";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.strokeStyle = "#000000";
			ctx.lineWidth = 1;
			ctx.strokeText(
				`Lv.${character.details.harmony_cube_lv}`,
				cubeX + itemSize / 2,
				cubeY + itemSize / 2
			);
			ctx.fillText(
				`Lv.${character.details.harmony_cube_lv}`,
				cubeX + itemSize / 2,
				cubeY + itemSize / 2
			);

			// 繪製「魔方」標籤
			ctx.font = getFontString(14, "normal", "魔方");
			ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
			ctx.textAlign = "center";
			ctx.strokeText("魔方", cubeX + itemSize / 2, cubeY - 10);
			ctx.fillText("魔方", cubeX + itemSize / 2, cubeY - 10);
		}

		return y + height;
	}

	// 繪製單個收藏品項目區塊
	static async drawCollectionItemBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		character: any,
		type: "favorite" | "harmony" | "harmony_battle" | "harmony_arena",
		accentColor: string = "#4A90E2"
	): Promise<number> {
		const padding = 20;
		const titleHeight = 40;
		const borderRadius = 20;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 計算內容區域
		const contentStartY =
			y + 15 + titleHeight + (type.startsWith("harmony") ? 15 : 5);
		const contentCenterX = x + width / 2;
		const itemSize = 100;

		if (type === "favorite" && character.details) {
			if (character.details.favorite_item_tid !== 0) {
				const weaponType = character.shot_id.element.weapon_type;
				const favoriteItemImage = await loadImage(
					ImagePathManager.getFavoriteItemImagePath(weaponType)
				);

				// 計算整體寬度以實現置中
				const totalWidth = itemSize;
				const startX = contentCenterX - totalWidth / 2;
				const favoriteX = startX;
				const favoriteY = contentStartY;

				// 繪製收藏品圖片
				ctx.drawImage(
					favoriteItemImage,
					favoriteX,
					favoriteY,
					itemSize,
					itemSize
				);

				// 獲取並繪製收藏品品級圖片（在右側）
				const rarity = getFavoriteItemRarity(
					character.details.favorite_item_tid
				);
				if (rarity) {
					// 繪製等級文字在品級下方
					ctx.font = getFontString(
						24,
						"bold",
						`Lv.${character.details.favorite_item_lv}`
					);
					ctx.fillStyle = "#FFFFFF";
					ctx.textAlign = "center";
					ctx.strokeStyle = "#000000";
					ctx.lineWidth = 1;
					// 繪製等級標籤在收藏品圖片下方（置中）
					await DrawingUtils.drawFavoriteItemLevelBadge(
						ctx,
						contentCenterX, // 使用中心位置
						favoriteY + itemSize + 5,
						character.details.favorite_item_lv,
						rarity
					);
				}
			} else {
				// 顯示暫無資料
				ctx.font = getFontString(24, "normal", "暫無資料");
				ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(
					"暫無資料",
					contentCenterX,
					contentStartY + itemSize / 2
				);
			}
		} else if (type === "harmony_battle" && character.details) {
			if (character.details.harmony_cube_tid !== 0) {
				try {
					// 載入並繪製戰鬥魔方圖片
					const cubeImage = await loadImage(
						ImagePathManager.getHarmonyCubeImagePath(
							character.details.harmony_cube_tid
						)
					);

					// 計算整體寬度以實現置中（魔方圖片 + 等級文字）
					const levelTextWidth = 60; // 預估等級文字寬度
					const spacing = 15;
					const totalWidth = itemSize + spacing + levelTextWidth;
					const startX = contentCenterX - totalWidth / 2;

					const cubeX = startX;
					const cubeY = contentStartY;

					// 繪製魔方圖片
					ctx.drawImage(cubeImage, cubeX, cubeY, itemSize, itemSize);

					// 繪製魔方等級文字（在右側）
					ctx.font = getFontString(
						24,
						"bold",
						`Lv.${character.details.harmony_cube_lv}`
					);
					ctx.fillStyle = "#FFFFFF";
					ctx.textAlign = "left";
					ctx.strokeStyle = "#000000";
					ctx.lineWidth = 1;
					const levelX = cubeX + itemSize + spacing;
					const levelY = cubeY + itemSize / 2;
					ctx.strokeText(
						`Lv.${character.details.harmony_cube_lv}`,
						levelX,
						levelY
					);
					ctx.fillText(
						`Lv.${character.details.harmony_cube_lv}`,
						levelX,
						levelY
					);
				} catch (error) {
					// 如果圖片載入失敗，回退到圓形顯示
					ctx.beginPath();
					ctx.arc(
						contentCenterX,
						contentStartY + itemSize / 2,
						itemSize / 2,
						0,
						2 * Math.PI
					);
					ctx.fillStyle = "rgba(255, 100, 100, 0.2)";
					ctx.fill();
					ctx.strokeStyle = "rgba(255, 100, 100, 0.5)";
					ctx.lineWidth = 2;
					ctx.stroke();

					ctx.font = getFontString(
						24,
						"bold",
						`Lv.${character.details.harmony_cube_lv}`
					);
					ctx.fillStyle = "#FFFFFF";
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.strokeStyle = "#000000";
					ctx.lineWidth = 1;
					ctx.strokeText(
						`Lv.${character.details.harmony_cube_lv}`,
						contentCenterX,
						contentStartY + itemSize / 2
					);
					ctx.fillText(
						`Lv.${character.details.harmony_cube_lv}`,
						contentCenterX,
						contentStartY + itemSize / 2
					);
				}
			} else {
				// 顯示暫無資料
				ctx.font = getFontString(24, "normal", "暫無資料");
				ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(
					"暫無資料",
					contentCenterX,
					contentStartY + itemSize / 2
				);
			}
		} else if (type === "harmony_arena" && character.details) {
			if (character.details.arena_harmony_cube_tid !== 0) {
				try {
					// 載入並繪製競技場魔方圖片
					const arenaCubeImage = await loadImage(
						ImagePathManager.getHarmonyCubeImagePath(
							character.details.arena_harmony_cube_tid
						)
					);

					// 計算整體寬度以實現置中（魔方圖片 + 等級文字）
					const levelTextWidth = 60; // 預估等級文字寬度
					const spacing = 15;
					const totalWidth = itemSize + spacing + levelTextWidth;
					const startX = contentCenterX - totalWidth / 2;

					const cubeX = startX;
					const cubeY = contentStartY;

					// 繪製魔方圖片
					ctx.drawImage(
						arenaCubeImage,
						cubeX,
						cubeY,
						itemSize,
						itemSize
					);

					// 繪製魔方等級文字（在右側）
					ctx.font = getFontString(
						24,
						"bold",
						`Lv.${character.details.arena_harmony_cube_lv}`
					);
					ctx.fillStyle = "#FFFFFF";
					ctx.textAlign = "left";
					ctx.strokeStyle = "#000000";
					ctx.lineWidth = 1;
					const levelX = cubeX + itemSize + spacing;
					const levelY = cubeY + itemSize / 2;
					ctx.strokeText(
						`Lv.${character.details.arena_harmony_cube_lv}`,
						levelX,
						levelY
					);
					ctx.fillText(
						`Lv.${character.details.arena_harmony_cube_lv}`,
						levelX,
						levelY
					);
				} catch (error) {
					// 如果圖片載入失敗，回退到圓形顯示
					ctx.beginPath();
					ctx.arc(
						contentCenterX,
						contentStartY + itemSize / 2,
						itemSize / 2,
						0,
						2 * Math.PI
					);
					ctx.fillStyle = "rgba(100, 100, 255, 0.2)";
					ctx.fill();
					ctx.strokeStyle = "rgba(100, 100, 255, 0.5)";
					ctx.lineWidth = 2;
					ctx.stroke();

					ctx.font = getFontString(
						24,
						"bold",
						`Lv.${character.details.arena_harmony_cube_lv}`
					);
					ctx.fillStyle = "#FFFFFF";
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.strokeStyle = "#000000";
					ctx.lineWidth = 1;
					ctx.strokeText(
						`Lv.${character.details.arena_harmony_cube_lv}`,
						contentCenterX,
						contentStartY + itemSize / 2
					);
					ctx.fillText(
						`Lv.${character.details.arena_harmony_cube_lv}`,
						contentCenterX,
						contentStartY + itemSize / 2
					);
				}
			} else {
				// 顯示暫無資料
				ctx.font = getFontString(24, "normal", "暫無資料");
				ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(
					"暫無資料",
					contentCenterX,
					contentStartY + itemSize / 2
				);
			}
		}

		return y + height;
	}

	// 繪製裝備資料區塊
	static async drawEquipmentBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		equipment: any,
		accentColor: string = "#4A90E2"
	): Promise<number> {
		const padding = 20;
		const titleHeight = 40;
		const borderRadius = 20;

		// 使用 Liquid Glass 效果
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 15,
			x + padding,
			y + 15 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 15,
			width - padding * 2,
			titleHeight,
			12
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(24, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 4;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 15, y + 15 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 計算內容區域
		const contentStartY = y + 15 + titleHeight + 15;
		const contentX = x + padding + 15;
		const contentWidth = width - padding * 2 - 30;
		const rowHeight = 50;
		const itemSpacing = 10;

		// 分成兩排顯示
		const leftColumnX = contentX;
		const rightColumnX = contentX + contentWidth / 2 + itemSpacing;
		const rightColumnWidth = contentWidth / 2 - itemSpacing;

		let currentY = contentStartY;

		// 裝備部位配置
		const equipmentParts = [
			{
				name: "手臂",
				key: "arm",
				tid: "arm_equip_tid",
				tier: "arm_equip_tier",
				options: [
					"arm_equip_option1_id",
					"arm_equip_option2_id",
					"arm_equip_option3_id"
				]
			},
			{
				name: "頭部",
				key: "head",
				tid: "head_equip_tid",
				tier: "head_equip_tier",
				options: [
					"head_equip_option1_id",
					"head_equip_option2_id",
					"head_equip_option3_id"
				]
			},
			{
				name: "腿部",
				key: "leg",
				tid: "leg_equip_tid",
				tier: "leg_equip_tier",
				options: [
					"leg_equip_option1_id",
					"leg_equip_option2_id",
					"leg_equip_option3_id"
				]
			},
			{
				name: "軀幹",
				key: "torso",
				tid: "torso_equip_tid",
				tier: "torso_equip_tier",
				options: [
					"torso_equip_option1_id",
					"torso_equip_option2_id",
					"torso_equip_option3_id"
				]
			}
		];

		// 繪製四個裝備部位
		for (let i = 0; i < equipmentParts.length; i++) {
			const part = equipmentParts[i];
			if (!part) continue;

			const hasEquipment =
				equipment[part.tid] && equipment[part.tid] !== 0;
			const tier = equipment[part.tier] || 0;

			// 決定位置（左右兩欄）
			const isLeftColumn = i % 2 === 0;
			const columnX = isLeftColumn ? leftColumnX : rightColumnX;
			const columnWidth = rightColumnWidth;

			// 每兩行換行
			if (i > 0 && i % 2 === 0) {
				currentY += rowHeight + itemSpacing;
			}

			// 裝備名稱
			ctx.font = getFontString(18, "bold", part.name);
			ctx.fillStyle = "#FFFFFF";
			ctx.textAlign = "left";
			ctx.fillText(part.name, columnX, currentY + 15);

			if (hasEquipment) {
				// 有裝備：顯示等級
				ctx.font = getFontString(16, "normal", `T${tier}`);
				ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
				ctx.fillText(`T${tier}`, columnX, currentY + 35);

				// 顯示裝備效果
				const effects = [];
				for (const optionKey of part.options) {
					const optionId = equipment[optionKey];
					if (optionId && optionId !== 0) {
						effects.push(`效果: ${optionId}`);
					}
				}

				if (effects.length > 0) {
					// 顯示所有效果
					for (let j = 0; j < Math.min(effects.length, 2); j++) {
						ctx.font = getFontString(14, "bold", effects[j]);
						ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
						ctx.fillText(
							effects[j],
							columnX,
							currentY + 50 + j * 15
						);
					}
				} else {
					// 無效果
					ctx.font = getFontString(14, "bold", "暫無效果");
					ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
					ctx.fillText("暫無效果", columnX, currentY + 50);
				}
			} else {
				// 無裝備
				ctx.font = getFontString(16, "bold", "暫無裝備");
				ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
				ctx.fillText("暫無裝備", columnX, currentY + 35);
			}
		}

		return y + height;
	}

	// 繪製單個裝備區塊
	static async drawSingleEquipmentBlock(
		ctx: any,
		x: number,
		y: number,
		width: number,
		height: number,
		title: string,
		equipment: any,
		part: any,
		character: any,
		accentColor: string = "#4A90E2"
	): Promise<number> {
		const padding = 15;
		const titleHeight = 30;
		const borderRadius = 16;

		// 使用 Liquid Glass 效果（較小的 radius）
		this.drawLiquidGlassRect(
			ctx,
			x,
			y,
			width,
			height,
			borderRadius,
			accentColor
		);

		// 繪製標題背景（更現代的樣式）
		const titleBgGradient = ctx.createLinearGradient(
			x + padding,
			y + 10,
			x + padding,
			y + 10 + titleHeight
		);
		titleBgGradient.addColorStop(0, "rgba(0, 0, 0, 0.4)");
		titleBgGradient.addColorStop(1, "rgba(0, 0, 0, 0.2)");

		this.drawRoundedRect(
			ctx,
			x + padding,
			y + 10,
			width - padding * 2,
			titleHeight,
			8
		);
		ctx.fillStyle = titleBgGradient;
		ctx.fill();

		// 添加標題背景的邊框
		ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
		ctx.lineWidth = 1;
		ctx.stroke();

		// 繪製標題文字（添加陰影效果）
		ctx.font = getFontString(18, "bold", title);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
		ctx.shadowBlur = 2;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.fillText(title, x + padding + 10, y + 10 + titleHeight / 2);

		// 清除陰影
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		// 計算內容區域
		const contentStartY = y + 10 + titleHeight + 15;
		const contentX = x + padding + 10;
		const contentWidth = width - padding * 2 - 20;

		// 分成左側裝備圖片（1/3）和右側效果（2/3）
		const leftWidth = contentWidth / 3;
		const rightWidth = (contentWidth * 2) / 3;
		const leftX = contentX;
		const rightX = contentX + leftWidth + 10; // 10px 間距

		const hasEquipment = equipment[part.tid] && equipment[part.tid] !== 0;
		const tier = equipment[part.tier] || 0;
		const equipmentLevel = equipment[`${part.key}_equip_lv`] || 0;

		// 左側：裝備圖片
		const equipmentImageSize = Math.min(
			leftWidth - 40,
			height - titleHeight - 60
		);
		const imageX = leftX + (leftWidth - equipmentImageSize) / 2;
		const imageY = contentStartY;

		if (hasEquipment) {
			try {
				// 載入並繪製裝備圖片
				const equipImagePath = ImagePathManager.getEquipmentImagePath(
					part.key,
					character.class,
					tier
				);
				const equipImage = await loadImage(equipImagePath);

				// 繪製裝備圖片（圓形裁剪）
				ctx.save();
				ctx.beginPath();
				ctx.arc(
					imageX + equipmentImageSize / 2,
					imageY + equipmentImageSize / 2,
					equipmentImageSize / 2,
					0,
					2 * Math.PI
				);
				ctx.clip();

				ctx.drawImage(
					equipImage,
					imageX,
					imageY,
					equipmentImageSize,
					equipmentImageSize
				);
				ctx.restore();

				// T9裝備需要顯示公司圖標
				if (tier === 9) {
					const corporationType =
						equipment[`${part.key}_equip_corporation_type`];

					if (corporationType && corporationType !== 0) {
						const iconBgWidth = equipmentImageSize * 0.35; // 公司圖標背景寬度
						const iconBgHeight = iconBgWidth * (72 / 63); // 根據63x72比例計算高度
						const iconX = imageX; // 貼齊左上角
						const iconY = imageY;

						// 載入並繪製公司圖標背景
						const bgImagePath = ImagePathManager.getIconBgPath();
						const bgImage = await loadImage(bgImagePath);

						ctx.drawImage(
							bgImage,
							iconX,
							iconY,
							iconBgWidth,
							iconBgHeight
						);

						// 載入並繪製公司圖標（在背景上方）
						const companyIconPath =
							ImagePathManager.getCompanyIconPath(
								corporationType
							);
						const companyIcon = await loadImage(companyIconPath);

						// 公司圖標稍微小一點，置中在背景內
						const companyIconSize = iconBgWidth * 0.8;
						const companyIconX =
							iconX + (iconBgWidth - companyIconSize) / 2;
						const companyIconY =
							iconY + (iconBgHeight - companyIconSize) / 2;

						ctx.drawImage(
							companyIcon,
							companyIconX,
							companyIconY,
							companyIconSize,
							companyIconSize
						);
					}
				}

				// 裝備等級標籤（在圖片下方）
				ctx.font = "bold 32px 'Deco'";
				ctx.fillStyle = "#FFFFFF";
				ctx.strokeStyle = "#000000";
				ctx.lineWidth = 2;
				ctx.textAlign = "center";
				ctx.textBaseline = "top";
				ctx.strokeText(
					`T${tier}   Lv.${equipmentLevel}`,
					imageX + equipmentImageSize / 2,
					imageY + equipmentImageSize + 5
				);
				ctx.fillText(
					`T${tier}   Lv.${equipmentLevel}`,
					imageX + equipmentImageSize / 2,
					imageY + equipmentImageSize + 5
				);
			} catch (error) {
				// 如果圖片載入失敗，顯示佔位符
				ctx.beginPath();
				ctx.arc(
					imageX + equipmentImageSize / 2,
					imageY + equipmentImageSize / 2,
					equipmentImageSize / 2,
					0,
					2 * Math.PI
				);
				ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
				ctx.fill();
				ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
				ctx.lineWidth = 2;
				ctx.stroke();

				// 裝備等級
				ctx.font = "bold 32px 'Deco'";
				ctx.fillStyle = "#FFFFFF";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(
					`T${tier}   Lv.${equipmentLevel}`,
					imageX + equipmentImageSize / 2,
					imageY + equipmentImageSize / 2
				);
			}
		} else {
			// 無裝備：顯示佔位符
			ctx.beginPath();
			ctx.arc(
				imageX + equipmentImageSize / 2,
				imageY + equipmentImageSize / 2,
				equipmentImageSize / 2,
				0,
				2 * Math.PI
			);
			ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
			ctx.fill();
			ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
			ctx.lineWidth = 1;
			ctx.stroke();

			ctx.font = getFontString(24, "normal", "無");
			ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(
				"無",
				imageX + equipmentImageSize / 2,
				imageY + equipmentImageSize / 2
			);
		}

		// 右側：裝備效果（三條上到下，平均分配高度）
		const availableHeight = height - titleHeight - 45; // 可用高度
		const effectHeight = availableHeight / 3; // 每條效果的平均高度
		const effectStartY = contentStartY; // 效果開始位置

		// 顯示裝備效果
		const effects = [];
		for (const optionKey of part.options) {
			const optionId = equipment[optionKey];
			if (optionId && optionId !== 0) {
				const parsedEffect = parseEquipmentEffect(optionId);
				effects.push(parsedEffect);
			} else {
				effects.push(null);
			}
		}

		// 確保顯示三條效果（補足空的效果）
		while (effects.length < 3) {
			effects.push(null);
		}

		// 繪製三條效果
		for (let j = 0; j < 3; j++) {
			const effectYPos =
				effectStartY + j * effectHeight + effectHeight / 2; // 每條效果的中心位置

			if (effects[j]) {
				// 有效果：顯示效果名稱和數值
				const effect = effects[j]!;

				// 根據等級設定顏色
				let titleColor = "#FFFFFF"; // 預設白色
				let valueColor = "rgba(255, 255, 255, 0.8)"; // 預設灰色
				let bgColor = "rgba(255, 255, 255, 0.1)"; // 預設白色背景

				if (effect.level >= 1 && effect.level <= 11) {
					// 1~10等：白底效果標題黑字 效果黑字
					titleColor = "#000000";
					valueColor = "#000000";
					bgColor = "rgba(255, 255, 255, 0.9)";
				} else if (effect.level >= 12 && effect.level <= 14) {
					// 11~14等：白底效果標題黑字 效果藍字
					titleColor = "#000000";
					valueColor = "#4A90E2";
					bgColor = "rgba(255, 255, 255, 0.9)";
				} else if (effect.level === 15) {
					// 15等：黑底效果標題灰字 效果藍字
					titleColor = "rgba(255, 255, 255, 0.6)";
					valueColor = "#4A90E2";
					bgColor = "rgba(0, 0, 0, 0.8)";
				}

				// 繪製圓角背景
				const bgWidth = rightWidth - 5;
				const bgHeight = 45;
				const bgX = rightX - 5;
				const bgY = effectYPos - 22.5;
				const borderRadius = 8; // 增大圓角

				ctx.fillStyle = bgColor;
				ctx.beginPath();
				ctx.moveTo(bgX + borderRadius, bgY);
				ctx.lineTo(bgX + bgWidth - borderRadius, bgY);
				ctx.quadraticCurveTo(
					bgX + bgWidth,
					bgY,
					bgX + bgWidth,
					bgY + borderRadius
				);
				ctx.lineTo(bgX + bgWidth, bgY + bgHeight - borderRadius);
				ctx.quadraticCurveTo(
					bgX + bgWidth,
					bgY + bgHeight,
					bgX + bgWidth - borderRadius,
					bgY + bgHeight
				);
				ctx.lineTo(bgX + borderRadius, bgY + bgHeight);
				ctx.quadraticCurveTo(
					bgX,
					bgY + bgHeight,
					bgX,
					bgY + bgHeight - borderRadius
				);
				ctx.lineTo(bgX, bgY + borderRadius);
				ctx.quadraticCurveTo(bgX, bgY, bgX + borderRadius, bgY);
				ctx.closePath();
				ctx.fill();

				// 繪製效果名稱（左側）
				ctx.font = getFontString(24, "bold", `【${effect.name}】`);
				ctx.fillStyle = titleColor;
				ctx.textAlign = "left";
				ctx.fillText(`【${effect.name}】`, rightX, effectYPos - 5);

				// 繪製效果數值（右側）
				ctx.font = "bold 30px Deco";
				ctx.fillStyle = valueColor;
				ctx.textAlign = "right";
				ctx.fillText(
					`+${effect.value}%`,
					rightX + bgWidth - 10,
					effectYPos - 15
				);
			} else {
				// 無效果 - 繪製與有效果時相同的白底圓角背景
				const bgWidth = rightWidth - 5;
				const bgHeight = 45;
				const bgX = rightX - 5;
				const bgY = effectYPos - 22.5;
				const borderRadius = 8;

				// 繪製白底圓角背景
				ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
				ctx.beginPath();
				ctx.moveTo(bgX + borderRadius, bgY);
				ctx.lineTo(bgX + bgWidth - borderRadius, bgY);
				ctx.quadraticCurveTo(
					bgX + bgWidth,
					bgY,
					bgX + bgWidth,
					bgY + borderRadius
				);
				ctx.lineTo(bgX + bgWidth, bgY + bgHeight - borderRadius);
				ctx.quadraticCurveTo(
					bgX + bgWidth,
					bgY + bgHeight,
					bgX + bgWidth - borderRadius,
					bgY + bgHeight
				);
				ctx.lineTo(bgX + borderRadius, bgY + bgHeight);
				ctx.quadraticCurveTo(
					bgX,
					bgY + bgHeight,
					bgX,
					bgY + bgHeight - borderRadius
				);
				ctx.lineTo(bgX, bgY + borderRadius);
				ctx.quadraticCurveTo(bgX, bgY, bgX + borderRadius, bgY);
				ctx.closePath();
				ctx.fill();

				// 繪製居中的"暫無效果"文字
				ctx.font = getFontString(24, "normal", "暫無效果");
				ctx.fillStyle = "rgba(0, 0, 0, 0.5)"; // 黑色半透明文字，在白底上更清晰
				ctx.textAlign = "center";
				ctx.fillText(
					"暫無效果",
					rightX + bgWidth / 2 - 5,
					effectYPos - 5
				);
			}
		}

		return y + height;
	}

	// 繪製收藏品等級標籤（品級色彩圓角背景 + 星星 + 階段文字）
	static async drawFavoriteItemLevelBadge(
		ctx: any,
		x: number,
		y: number,
		level: number,
		rarity: string
	): Promise<void> {
		// 計算星星數量和階段
		let stars: number;
		if (rarity === "SSR") {
			// SSR: 每多一級多一顆星
			stars = Math.min(3, level + 1);
		} else {
			// 其他品級: 每5級一顆星，最多3顆
			stars = Math.min(3, Math.floor(level / 5) + 1);
		}

		// 計算標籤寬度
		const starSize = 16;
		const starSpacing = 2;
		const stageString = `${level}階段`;
		ctx.font = getFontString(16, "bold", `${level}階段`);
		const textWidth = ctx.measureText(stageString).width;
		const padding = 12;
		const badgeWidth =
			padding +
			stars * starSize +
			(stars - 1) * starSpacing +
			8 + // 星星和文字之間的間距
			textWidth +
			padding;
		const badgeHeight = 20;

		// 根據品級設定背景顏色
		let bgColor = "#F88128"; // 預設橙色
		switch (rarity) {
			case "SR":
				bgColor = "#c261ff";
				break;
			case "R":
				bgColor = "#1ec8ff";
				break;
			case "SSR":
				bgColor = "#f88128";
				break;
		}

		// 計算實際繪製位置（以 x 為中心）
		const actualX = x - badgeWidth / 2;

		// 繪製品級色彩圓角背景
		this.drawRoundedRect(ctx, actualX, y, badgeWidth, badgeHeight, 10);
		ctx.fillStyle = bgColor;
		ctx.fill();

		// 繪製星星（使用 star.svg）
		let currentX = actualX + padding;
		for (let i = 0; i < stars; i++) {
			const starSvg = await loadImage(ImagePathManager.getStarSvgPath());
			ctx.drawImage(starSvg, currentX, y, starSize, starSize);
			currentX += starSize + starSpacing;
		}

		// 繪製階段文字
		ctx.font = getFontString(16, "bold", `${level}階段`);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(`${level}階段`, currentX + 8, y + badgeHeight / 2);
	}
}

// 計算適合角色名稱的字體大小和處理文字截斷
const calculateNameFontSize = (
	ctx: any,
	name: string,
	maxWidth: number
): { fontSize: number; displayName: string } => {
	let fontSize = CONFIG.NAME_DISPLAY.MAX_FONT_SIZE;
	let displayName = name;

	// 首先檢查是否需要截斷文字
	ctx.font = getFontString(CONFIG.NAME_DISPLAY.MIN_FONT_SIZE, "normal", name);
	const minSizeMetrics = ctx.measureText(name);

	// 如果最小字體都超出寬度，則截斷文字
	if (minSizeMetrics.width > maxWidth) {
		displayName = truncateText(
			ctx,
			name,
			maxWidth,
			CONFIG.NAME_DISPLAY.MIN_FONT_SIZE
		);
	}

	// 從最大字體開始，逐步縮小直到文字適合寬度
	while (fontSize >= CONFIG.NAME_DISPLAY.MIN_FONT_SIZE) {
		ctx.font = getFontString(fontSize, "normal", displayName);
		const textMetrics = ctx.measureText(displayName);

		if (textMetrics.width <= maxWidth) {
			break;
		}

		fontSize -= 2; // 每次減少2px
	}

	return {
		fontSize: Math.max(fontSize, CONFIG.NAME_DISPLAY.MIN_FONT_SIZE),
		displayName
	};
};

// 截斷文字的輔助函數
const truncateText = (
	ctx: any,
	text: string,
	maxWidth: number,
	fontSize: number
): string => {
	const ellipsis = "...";
	ctx.font = getFontString(fontSize, "normal", text);

	let truncatedText = text;
	let ellipsisWidth = ctx.measureText(ellipsis).width;

	while (truncatedText.length > 0) {
		const textWidth = ctx.measureText(truncatedText).width;

		if (textWidth + ellipsisWidth <= maxWidth) {
			return truncatedText + ellipsis;
		}

		truncatedText = truncatedText.slice(0, -1);
	}

	return ellipsis;
};

// 繪製突破等級星星
const drawGradeStars = async (
	ctx: any,
	grade: number,
	rarity: string,
	x: number,
	y: number,
	starSize: number = CONFIG.STAR.SIZE,
	spacing: number = CONFIG.STAR.SPACING
): Promise<void> => {
	try {
		// 根據稀有度決定最大星星數量
		const maxStarsMap: Record<string, number> = {
			SSR: 3,
			SR: 2,
			R: 0
		};
		const maxStars = maxStarsMap[rarity] || 0;

		if (maxStars === 0) return;

		const [goldStarIcon, normalStarIcon] = await Promise.all([
			loadImage(ImagePathManager.getStarIconPath(true)),
			loadImage(ImagePathManager.getStarIconPath(false))
		]);

		const goldStars = Math.min(grade, maxStars);

		// 從右到左繪製星星
		for (let i = 0; i < maxStars; i++) {
			const starX = x - (i + 1) * starSize - i * spacing;
			const isGold = i >= maxStars - goldStars;
			const starIcon = isGold ? goldStarIcon : normalStarIcon;

			ctx.drawImage(starIcon, starX, y, starSize, starSize);
		}
	} catch (error) {
		logger.warn("無法繪製突破等級星星", { error });
	}
};

// 繪製 core 資訊
const drawCoreInfo = async (
	ctx: any,
	core: number,
	x: number,
	y: number,
	iconSize: number = 40
): Promise<void> => {
	try {
		const coreIcon = await loadImage(ImagePathManager.getCoreIconPath());

		// 繪製 core 圖標
		ctx.drawImage(coreIcon, x, y, iconSize, iconSize);

		// 繪製 core 數字
		const coreText = core === 7 ? "max" : core.toString();
		ctx.font = getFontString(20, "bold", coreText);
		ctx.fillStyle = CONFIG.COLORS.TEXT;
		ctx.textAlign = "center";
		ctx.fillText(coreText, x + iconSize / 2, y + iconSize / 2 + 6);
	} catch (error) {
		logger.warn("無法繪製 core 資訊", { error });
	}
};

// 排序函數
function sortCharacters(
	characters: Character[],
	sortType: SortType
): Character[] {
	return [...characters].sort((a, b) => {
		switch (sortType) {
			case "combat":
				return (b.combat || 0) - (a.combat || 0);
			case "level":
				return (b.lv || 0) - (a.lv || 0);
			case "grade":
				const totalGradeA = (a.grade || 0) + (a.core || 0);
				const totalGradeB = (b.grade || 0) + (b.core || 0);
				return totalGradeB - totalGradeA;
			case "rarity":
				const rarityOrder = { SSR: 3, SR: 2, R: 1 };
				return (
					(rarityOrder[b.original_rare as keyof typeof rarityOrder] ||
						0) -
					(rarityOrder[a.original_rare as keyof typeof rarityOrder] ||
						0)
				);
			default:
				return 0;
		}
	});
}

// 篩選函數
function filterCharacters(
	characters: Character[],
	filters: FilterOptions
): Character[] {
	return characters.filter(character => {
		// 職業篩選
		if (
			filters.classes.length > 0 &&
			!filters.classes.includes(character.class)
		) {
			return false;
		}

		// 公司篩選
		if (
			filters.corporations.length > 0 &&
			!filters.corporations.includes(character.corporation)
		) {
			return false;
		}

		// 武器類型篩選
		if (
			filters.weaponTypes.length > 0 &&
			!filters.weaponTypes.includes(character.shot_id.element.weapon_type)
		) {
			return false;
		}

		// 元素篩選
		if (
			filters.elements.length > 0 &&
			!filters.elements.includes(character.element_id.element.element)
		) {
			return false;
		}

		return true;
	});
}

// 創建排序 SelectMenu
function createSortSelectMenu(
	currentSort: SortType
): ActionRowBuilder<StringSelectMenuBuilder> {
	const sortOptions = [
		{ value: "combat", label: "戰鬥力", description: "按戰鬥力排序" },
		{ value: "level", label: "等級", description: "按等級排序" },
		{ value: "grade", label: "極限突破", description: "按突破等級排序" },
		{ value: "rarity", label: "稀有度", description: "按稀有度排序" }
	];

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId("character_sort")
		.setPlaceholder("選擇排序方式")
		.addOptions(
			sortOptions.map(option =>
				new StringSelectMenuOptionBuilder()
					.setLabel(option.label)
					.setDescription(option.description)
					.setValue(option.value)
					.setDefault(option.value === currentSort)
			)
		);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		selectMenu
	);
}

// 創建篩選 SelectMenu
function createFilterSelectMenu(
	currentFilters: FilterOptions
): ActionRowBuilder<StringSelectMenuBuilder> {
	const filterOptions = [
		// 職業
		{ value: "class_Attacker", label: "Attacker", description: "攻擊型" },
		{ value: "class_Defender", label: "Defender", description: "防禦型" },
		{ value: "class_Supporter", label: "Supporter", description: "支援型" },
		// 公司
		{ value: "corp_ELYSION", label: "ELYSION", description: "極樂淨土" },
		{ value: "corp_MISSILIS", label: "MISSILIS", description: "米西利斯" },
		{ value: "corp_TETRA", label: "TETRA", description: "泰特拉" },
		{ value: "corp_PILGRIM", label: "PILGRIM", description: "朝聖者" },
		{ value: "corp_ABNORMAL", label: "ABNORMAL", description: "異常" },
		// 武器類型
		{ value: "weapon_SMG", label: "SMG", description: "衝鋒槍" },
		{ value: "weapon_RL", label: "RL", description: "火箭筒" },
		{ value: "weapon_AR", label: "AR", description: "突擊步槍" },
		{ value: "weapon_SG", label: "SG", description: "霰彈槍" },
		{ value: "weapon_SR", label: "SR", description: "狙擊步槍" },
		{ value: "weapon_MG", label: "MG", description: "機槍" },
		// 元素
		{ value: "element_Electronic", label: "電擊", description: "電擊屬性" },
		{ value: "element_Fire", label: "燃燒", description: "燃燒屬性" },
		{ value: "element_Wind", label: "風壓", description: "風壓屬性" },
		{ value: "element_Water", label: "水冷", description: "水冷屬性" },
		{ value: "element_Iron", label: "鐵甲", description: "鐵甲屬性" }
	];

	const selectMenu = new StringSelectMenuBuilder()
		.setCustomId("character_filter")
		.setPlaceholder("選擇篩選條件 (可多選)")
		.setMinValues(0)
		.setMaxValues(filterOptions.length)
		.addOptions(
			filterOptions.map(option => {
				const isSelected = isFilterSelected(
					option.value,
					currentFilters
				);
				return new StringSelectMenuOptionBuilder()
					.setLabel(option.label)
					.setDescription(option.description)
					.setValue(option.value)
					.setDefault(isSelected);
			})
		);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		selectMenu
	);
}

// 檢查篩選是否被選中
function isFilterSelected(value: string, filters: FilterOptions): boolean {
	const [type, item] = value.split("_");

	if (!item) return false;

	switch (type) {
		case "class":
			return filters.classes.includes(item);
		case "corp":
			return filters.corporations.includes(item);
		case "weapon":
			return filters.weaponTypes.includes(item);
		case "element":
			return filters.elements.includes(item);
		default:
			return false;
	}
}

// 解析篩選選項
function parseFilterValues(values: string[]): FilterOptions {
	const filters: FilterOptions = {
		classes: [],
		corporations: [],
		weaponTypes: [],
		elements: []
	};

	values.forEach(value => {
		const [type, item] = value.split("_");

		if (!item) return;

		switch (type) {
			case "class":
				filters.classes.push(item);
				break;
			case "corp":
				filters.corporations.push(item);
				break;
			case "weapon":
				filters.weaponTypes.push(item);
				break;
			case "element":
				filters.elements.push(item);
				break;
		}
	});

	return filters;
}

// 生成玩家角色圖片
async function generateUserCharactersImage(
	userCharacters: Character[]
): Promise<Buffer> {
	const totalCharacters = userCharacters.length;
	const rows = Math.ceil(totalCharacters / CONFIG.CARD.CARDS_PER_ROW);

	const canvasWidth =
		CONFIG.CARD.CARDS_PER_ROW * CONFIG.CARD.WIDTH +
		(CONFIG.CARD.CARDS_PER_ROW - 1) * CONFIG.CARD.SPACING +
		CONFIG.CARD.PADDING * 2;
	const canvasHeight =
		rows * CONFIG.CARD.HEIGHT +
		(rows - 1) * CONFIG.CARD.SPACING +
		CONFIG.CARD.PADDING * 2;

	const canvas = ResourceManager.createCanvas(canvasWidth, canvasHeight);
	const ctx = canvas.getContext("2d");

	// 填充背景
	ctx.fillStyle = CONFIG.COLORS.BACKGROUND;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	// 並行繪製所有角色卡片
	const drawPromises = userCharacters.map(async (character, i) => {
		if (!character) return;

		const row = Math.floor(i / CONFIG.CARD.CARDS_PER_ROW);
		const col = i % CONFIG.CARD.CARDS_PER_ROW;

		const x =
			CONFIG.CARD.PADDING +
			col * (CONFIG.CARD.WIDTH + CONFIG.CARD.SPACING);
		const y =
			CONFIG.CARD.PADDING +
			row * (CONFIG.CARD.HEIGHT + CONFIG.CARD.SPACING);

		await drawUserCharacterCard(ctx, character, x, y);
	});

	await Promise.all(drawPromises);

	const buffer = canvas.toBuffer("image/png");

	// 釋放 Canvas 資源
	ResourceManager.releaseCanvas(canvas);

	return buffer;
}

// 繪製玩家角色卡片（包含玩家數值）
async function drawUserCharacterCard(
	ctx: any,
	character: Character,
	x: number,
	y: number
): Promise<void> {
	try {
		const bottomY = y + CONFIG.CARD.HEIGHT - CONFIG.CARD.RARITY_BG_HEIGHT;

		// 優化的圖片加載 - 並行加載所有圖片
		const imagePaths = [
			ImagePathManager.getIconBgPath(),
			ImagePathManager.getCharacterPortraitPath(
				character.resource_id,
				character.costume_index || undefined
			),
			ImagePathManager.getRarityBgPath(character.original_rare),
			ImagePathManager.getJobIconPath(
				character.class,
				character.original_rare
			),
			ImagePathManager.getElementIconPath(
				character.element_id.element.element
			),
			ImagePathManager.getWeaponIconPath(
				character.shot_id.element.weapon_type
			),
			ImagePathManager.getBurstSkillIconPath(character.use_burst_skill)
		];

		const imageMap = await ImageLoader.loadMultipleImages(imagePaths);

		// 創建圖片引用映射
		const charImages = new Map<string, any>();
		const sharedImages = new Map<string, any>();

		sharedImages.set(
			"iconBg",
			imageMap.get(ImagePathManager.getIconBgPath())
		);
		charImages.set(
			"portrait",
			imageMap.get(
				ImagePathManager.getCharacterPortraitPath(
					character.resource_id,
					character.costume_index || undefined
				)
			)
		);
		charImages.set(
			"rarityBg",
			imageMap.get(
				ImagePathManager.getRarityBgPath(character.original_rare)
			)
		);
		charImages.set(
			"jobIcon",
			imageMap.get(
				ImagePathManager.getJobIconPath(
					character.class,
					character.original_rare
				)
			)
		);
		charImages.set(
			"elementIcon",
			imageMap.get(
				ImagePathManager.getElementIconPath(
					character.element_id.element.element
				)
			)
		);
		charImages.set(
			"weaponIcon",
			imageMap.get(
				ImagePathManager.getWeaponIconPath(
					character.shot_id.element.weapon_type
				)
			)
		);
		charImages.set(
			"burstSkillIcon",
			imageMap.get(
				ImagePathManager.getBurstSkillIconPath(
					character.use_burst_skill
				)
			)
		);

		// 1. 繪製角色頭像
		const portrait = charImages.get("portrait");
		if (portrait) {
			ctx.drawImage(
				portrait,
				x,
				y,
				CONFIG.CARD.PORTRAIT_SIZE,
				CONFIG.CARD.PORTRAIT_SIZE
			);
		}

		// 2. 繪製底部資訊欄（使用稀有度背景）
		const rarityBg = charImages.get("rarityBg");
		if (rarityBg) {
			ctx.drawImage(
				rarityBg,
				x,
				bottomY,
				CONFIG.CARD.WIDTH,
				CONFIG.CARD.RARITY_BG_HEIGHT
			);
		}

		// 3. 繪製職業圖標背景
		const jobIcon = charImages.get("jobIcon");
		if (jobIcon) {
			const jobIconX = x + CONFIG.CARD.WIDTH - CONFIG.ICON.JOB_SIZE;
			const jobIconY =
				bottomY +
				(CONFIG.CARD.RARITY_BG_HEIGHT - CONFIG.ICON.JOB_SIZE) / 2 -
				20;
			ctx.drawImage(
				jobIcon,
				jobIconX,
				jobIconY,
				CONFIG.ICON.JOB_SIZE,
				CONFIG.ICON.JOB_SIZE
			);
		}

		// 4. 繪製突破等級星星和 core 資訊
		const starsY = bottomY + 30;
		let rightEdge = x + CONFIG.CARD.WIDTH - 10; // 右邊界起始位置

		// 如果有 core，先繪製 core
		if (character.core !== undefined && character.core > 0) {
			const coreSize = 40;
			const coreX = rightEdge - coreSize;
			const coreY = starsY;
			await drawCoreInfo(ctx, character.core, coreX, coreY, coreSize);
			rightEdge = coreX - 5; // 更新右邊界，留出間距
		}

		// 繪製星星（從右到左）
		if (character.grade !== undefined) {
			await drawGradeStars(
				ctx,
				character.grade,
				character.original_rare,
				rightEdge,
				starsY
			);
		}

		// 計算適合的字體大小和顯示名稱（考慮等級文字寬度）
		const levelWidth = 50; // 為等級文字預留空間
		const availableWidth = CONFIG.NAME_DISPLAY.MAX_WIDTH - levelWidth;
		const nameInfo = calculateNameFontSize(
			ctx,
			character.name_localkey.name,
			availableWidth
		);
		ctx.font = getFontString(
			nameInfo.fontSize,
			"normal",
			nameInfo.displayName
		);
		ctx.strokeStyle = "#000000";
		ctx.fillStyle = CONFIG.COLORS.TEXT;
		ctx.textAlign = "right";
		ctx.lineWidth = 3;
		const nameY =
			bottomY + CONFIG.CARD.RARITY_BG_HEIGHT / 2 + nameInfo.fontSize / 2;
		ctx.strokeText(nameInfo.displayName, x + CONFIG.CARD.WIDTH - 10, nameY);
		ctx.fillText(nameInfo.displayName, x + CONFIG.CARD.WIDTH - 10, nameY);

		// 6. 繪製戰鬥力（在角色名稱下方）
		if (character.combat !== undefined) {
			const combatY = bottomY + CONFIG.CARD.RARITY_BG_HEIGHT / 2 + 52.5;
			const combatX = x + CONFIG.CARD.WIDTH - 10;

			// 先繪製戰鬥力數字（較大字體）
			const combatText = character.combat.toLocaleString();
			ctx.font = getFontString(
				CONFIG.FONT.COMBAT_VALUE,
				"bold",
				combatText
			);
			ctx.strokeStyle = CONFIG.COLORS.STROKE;
			ctx.textAlign = "right";
			ctx.lineWidth = 3;
			ctx.strokeText(combatText, combatX, combatY);
			ctx.fillStyle = CONFIG.COLORS.TEXT;
			ctx.fillText(combatText, combatX, combatY);

			// 計算數字寬度，然後在左側繪製「戰鬥力」文字
			const combatTextWidth = ctx.measureText(combatText).width;
			const labelX = combatX - combatTextWidth - 7.5;

			// 繪製「戰鬥力」文字（較小字體）
			DrawingUtils.drawTextWithStroke(
				ctx,
				"戰鬥力",
				labelX,
				combatY,
				getFontString(CONFIG.FONT.COMBAT_LABEL, "bold", "戰鬥力")
			);
		}

		// 5. 繪製左上角圖標
		let currentIconY = y + 20;

		// 元素圖標
		const elementIcon = charImages.get("elementIcon");
		if (elementIcon) {
			ctx.drawImage(
				elementIcon,
				x + CONFIG.ICON.PADDING,
				currentIconY,
				CONFIG.ICON.SIZE_X,
				CONFIG.ICON.SIZE_Y
			);
		}

		currentIconY += CONFIG.ICON.SIZE_Y + CONFIG.ICON.PADDING;

		// 武器圖標
		const iconBg = sharedImages.get("iconBg");
		const weaponIcon = charImages.get("weaponIcon");
		if (iconBg && weaponIcon) {
			ctx.drawImage(
				iconBg,
				x + CONFIG.ICON.PADDING,
				currentIconY,
				CONFIG.ICON.SIZE_X,
				CONFIG.ICON.SIZE_Y
			);
			ctx.drawImage(
				weaponIcon,
				x + CONFIG.ICON.PADDING + CONFIG.ICON.SIZE_X * 0.1,
				currentIconY + CONFIG.ICON.SIZE_Y * 0.1,
				CONFIG.ICON.SIZE_X * 0.8,
				CONFIG.ICON.SIZE_Y * 0.8
			);
		}

		currentIconY += CONFIG.ICON.SIZE_Y + CONFIG.ICON.PADDING;

		// 爆裂技能圖標
		const burstSkillIcon = charImages.get("burstSkillIcon");
		if (iconBg && burstSkillIcon) {
			ctx.drawImage(
				iconBg,
				x + CONFIG.ICON.PADDING,
				currentIconY,
				CONFIG.ICON.SIZE_X,
				CONFIG.ICON.SIZE_Y
			);
			ctx.drawImage(
				burstSkillIcon,
				x + CONFIG.ICON.PADDING + CONFIG.ICON.SIZE_X * 0.1,
				currentIconY + CONFIG.ICON.SIZE_Y * 0.1,
				CONFIG.ICON.SIZE_X * 0.8,
				CONFIG.ICON.SIZE_Y * 0.8
			);
		}

		// 8. 繪製等級（在左側底部，分成兩行，帶字框背景）
		if (character.lv !== undefined) {
			const levelX = x + 15;
			const levelY = bottomY + CONFIG.CARD.RARITY_BG_HEIGHT - 25;
			const levelText = character.lv.toString();

			// 繪製等級數字文字（帶描邊）
			ctx.textAlign = "left";
			ctx.font = "bold 44px 'Deco'";
			ctx.strokeStyle = CONFIG.COLORS.STROKE;
			ctx.lineWidth = 3;
			ctx.strokeText(levelText, levelX, levelY);
			ctx.fillStyle = CONFIG.COLORS.TEXT;
			ctx.fillText(levelText, levelX, levelY);

			// 繪製 LV. 文字（帶描邊）
			ctx.font = "bold 28px 'Deco'";
			const levelTextWidth = ctx.measureText(levelText).width / 2;
			const lvX = levelX + levelTextWidth / 2;
			const lvY = bottomY + CONFIG.CARD.RARITY_BG_HEIGHT - 67.5;

			ctx.strokeStyle = CONFIG.COLORS.STROKE;
			ctx.lineWidth = 3;
			ctx.strokeText("LV.", lvX, lvY);
			ctx.fillStyle = CONFIG.COLORS.TEXT;
			ctx.fillText("LV.", lvX, lvY);
		}
	} catch (error) {
		logger.warn(`無法繪製玩家角色卡片: ${character.name_localkey.name}`, {
			error
		});
	}
}

// 生成單個角色詳細圖片
async function generateCharacterDetailImage(
	character: Character
): Promise<Buffer> {
	const canvasWidth = 2000;
	const canvasHeight = 1200;

	const canvas = ResourceManager.createCanvas(canvasWidth, canvasHeight);
	const ctx = canvas.getContext("2d");

	// 獲取英文角色名稱用於 Wiki 查詢
	const characterEnName = character.name_code
		? getCharacterEnName(character.name_code)
		: null;

	// 獲取角色主要顏色
	const mainColor = await CharacterImageDownloader.getCharacterMainColor(
		character.resource_id,
		characterEnName || character.name_localkey.name,
		character.costume_index || undefined
	);

	// 創建背景漸層
	// const gradient = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
	// if (mainColor) {
	// 	// 使用主要顏色創建漸層背景
	// 	gradient.addColorStop(0, mainColor + "40"); // 25% 透明度
	// 	gradient.addColorStop(0.5, mainColor + "20"); // 12.5% 透明度
	// 	gradient.addColorStop(1, "#1a1a1a");
	// } else {
	// 	// 預設漸層
	// 	gradient.addColorStop(0, "#2a2a2a");
	// 	gradient.addColorStop(1, "#1a1a1a");
	// }
	// ctx.fillStyle = gradient;
	// ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	ctx.fillStyle = CONFIG.COLORS.BACKGROUND;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	ctx.drawImage(
		await loadImage("src/assets/images/swiper4_left_icon.png"),
		20,
		20
	);

	try {
		// 嘗試使用高質量角色圖片（優先從 Wiki 下載）
		let portraitPath =
			await CharacterImageDownloader.downloadCharacterImage(
				character.resource_id,
				characterEnName || character.name_localkey.name,
				character.costume_index || undefined
			);

		// 如果下載失敗，回退到原始圖片
		if (!portraitPath) {
			portraitPath = ImagePathManager.getCharacterPortraitPath(
				character.resource_id,
				character.costume_index || undefined
			);
		}

		const fullPortrait = await loadImage(portraitPath);

		// 計算角色圖片尺寸，放大到畫布高度的1.5倍並根據原始比例計算寬度
		const targetHeight = canvasHeight * 1.5; // 放大
		const scale = targetHeight / fullPortrait.height;
		const imageHeight = targetHeight;
		const imageWidth = fullPortrait.width * scale; // 根據原始比例計算寬度

		// 基準角色圖片寬度
		const baseImageWidth = 1030;

		// 根據圖片寬度動態調整角色中心點位置
		let characterCenterX;
		if (imageWidth > baseImageWidth) {
			// 大於基準寬度的圖片往左移動
			const offsetRatio = (imageWidth - baseImageWidth) / baseImageWidth;
			characterCenterX = canvasWidth * (0.25 - offsetRatio * 0.05); // 向左偏移
		} else {
			// 小於基準寬度的圖片往右移動
			const offsetRatio = (baseImageWidth - imageWidth) / baseImageWidth;
			characterCenterX = canvasWidth * (0.25 + offsetRatio * 0.05); // 向右偏移
		}

		// 計算角色圖片位置，使角色中心點對齊到動態位置
		const finalX = characterCenterX - imageWidth / 2; // 圖片左邊界位置
		ctx.drawImage(fullPortrait, finalX, 0, imageWidth, imageHeight);

		// 計算資訊區域位置（固定位置，不受角色圖片大小影響）
		const infoAreaX = canvasWidth * 0.4; // 固定資訊區域起始位置（畫布寬度的30%處）
		const infoAreaWidth = canvasWidth - infoAreaX - 40; // 剩餘寬度用於資訊，右側留邊距

		// 繪製資訊區域背景（使用 Liquid Glass 效果）
		DrawingUtils.drawLiquidGlassRect(
			ctx,
			infoAreaX,
			40,
			infoAreaWidth,
			canvasHeight - 80,
			20,
			mainColor || "#4A90E2"
		);

		// 資訊區塊的配置
		const blockWidth = infoAreaWidth - 60;
		const blockSpacing = 20;
		let currentY = 215; // 調整到角色名稱下方
		const leftMargin = infoAreaX + 30;
		const accentColor = mainColor || "#4A90E2";

		// 繪製角色名稱和稀有度在資訊框頂部
		const headerY = 130;
		const headerX = leftMargin;

		// 繪製角色名稱
		ctx.font = getFontString(64, "bold", character.name_localkey.name);
		ctx.fillStyle = "#FFFFFF";
		ctx.textAlign = "left";
		ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
		ctx.lineWidth = 3;
		ctx.strokeText(character.name_localkey.name, headerX, headerY);
		ctx.fillText(character.name_localkey.name, headerX, headerY);

		// 計算角色名稱寬度
		const nameWidth = ctx.measureText(character.name_localkey.name).width;

		// 載入並繪製稀有度圖片在角色名稱右方
		const rarityImagePath = ImagePathManager.getRarityImagePath(
			character.original_rare
		);
		const rarityImage = await loadImage(rarityImagePath);
		const raritySize = 64;
		const rarityX = headerX + nameWidth + 20; // 距離名稱右邊20px
		const rarityY = headerY - raritySize + 16; // 對齊名稱基線

		ctx.drawImage(rarityImage, rarityX, rarityY, raritySize, raritySize);

		// 繪製 Grade 和 Core 資訊在名稱下方（使用圖片）
		const gradeInfoY = headerY + 20;
		if (character.grade !== undefined || character.core !== undefined) {
			const starSize = 48;
			const coreSize = 48;
			const itemSpacing = 10;
			let rightEdge = headerX + 3 * starSize + itemSpacing; // 從角色名稱左邊開始

			// 繪製星星（從左到右）
			if (character.grade !== undefined && character.grade > 0) {
				await drawGradeStars(
					ctx,
					character.grade,
					character.original_rare,
					rightEdge,
					gradeInfoY,
					starSize,
					5 // 星星間距
				);
				// 計算星星占用的寬度
				const maxStarsMap: Record<string, number> = {
					SSR: 3,
					SR: 2,
					R: 0
				};
				const maxStars = maxStarsMap[character.original_rare] || 0;
				if (maxStars > 0) {
					rightEdge +=
						maxStars * starSize + (maxStars - 1) * 5 + itemSpacing;
				}
			}

			// 繪製 core（在星星右邊）
			if (character.core !== undefined && character.core > 0) {
				await drawCoreInfo(
					ctx,
					character.core,
					rightEdge,
					gradeInfoY,
					coreSize
				);
			}
		}

		// 預先載入所有需要的圖片
		const iconImages = new Map<string, any>();
		const iconPaths = [
			{
				key: "element",
				path: ImagePathManager.getElementIconPath(
					character.element_id.element.element
				)
			},
			{
				key: "weapon",
				path: ImagePathManager.getWeaponIconPath(
					character.shot_id.element.weapon_type
				)
			},
			{
				key: "burst",
				path: ImagePathManager.getBurstSkillIconPath(
					character.use_burst_skill
				)
			},
			{
				key: "job",
				path: ImagePathManager.getJobImagePath(character.class)
			},
			{
				key: "company",
				path: ImagePathManager.getCompanyImagePath(
					character.corporation
				)
			},
			{ key: "iconBg", path: ImagePathManager.getIconBgPath() },
			{ key: "iconBgEmpty", path: ImagePathManager.getIconBgPath() }
		];

		for (const iconPath of iconPaths) {
			try {
				iconImages.set(iconPath.key, await loadImage(iconPath.path));
			} catch (error) {
				logger.warn(`無法載入圖片: ${iconPath.path}`);
			}
		}

		// 計算三個區塊的寬度和位置
		const blockCount = 3;
		const totalSpacing = (blockCount - 1) * blockSpacing;
		const individualBlockWidth = (blockWidth - totalSpacing) / blockCount;
		const blockHeight = 200; // 固定高度

		// 1. 戰鬥數據區塊（與全部角色頁面相同的樣式）
		await DrawingUtils.drawCombatDataBlock(
			ctx,
			leftMargin,
			currentY,
			individualBlockWidth,
			blockHeight,
			"戰鬥數據",
			character,
			accentColor
		);

		// 2. 基本屬性區塊（只顯示圖片）
		DrawingUtils.drawBasicAttributesBlock(
			ctx,
			leftMargin + individualBlockWidth + blockSpacing,
			currentY,
			individualBlockWidth,
			blockHeight,
			"妮姬資訊",
			{
				element: iconImages.get("element"),
				weapon: iconImages.get("weapon"),
				job: iconImages.get("job"),
				company: iconImages.get("company"),
				burst: iconImages.get("burst"),
				iconBg: iconImages.get("iconBg"),
				iconBgEmpty: iconImages.get("iconBgEmpty")
			},
			accentColor
		);

		// 3. 技能等級區塊（圓形設計）
		if (character.skills) {
			DrawingUtils.drawSkillsBlock(
				ctx,
				leftMargin + (individualBlockWidth + blockSpacing) * 2,
				currentY,
				individualBlockWidth,
				blockHeight,
				"技能等級",
				character.skills,
				accentColor
			);
		}

		currentY += blockHeight + blockSpacing;

		// 4. 收藏品和魔方區塊（分成三個獨立區塊）
		if (character.details) {
			// 計算三個區塊的寬度
			const threeBlockCount = 3;
			const threeBlockSpacing = blockSpacing;
			const threeBlockWidth =
				(blockWidth - threeBlockSpacing * 2) / threeBlockCount;

			// 收藏品區塊（左側）- 總是顯示
			await DrawingUtils.drawCollectionItemBlock(
				ctx,
				leftMargin,
				currentY,
				threeBlockWidth,
				blockHeight,
				"收藏品",
				character,
				"favorite",
				accentColor
			);

			// 魔方(戰鬥)區塊（中間）- 總是顯示
			await DrawingUtils.drawCollectionItemBlock(
				ctx,
				leftMargin + threeBlockWidth + threeBlockSpacing,
				currentY,
				threeBlockWidth,
				blockHeight,
				"戰鬥魔方",
				character,
				"harmony_battle",
				accentColor
			);

			// 魔方(競技場)區塊（右側）- 總是顯示
			await DrawingUtils.drawCollectionItemBlock(
				ctx,
				leftMargin + (threeBlockWidth + threeBlockSpacing) * 2,
				currentY,
				threeBlockWidth,
				blockHeight,
				"競技場魔方",
				character,
				"harmony_arena",
				accentColor
			);

			currentY += blockHeight + blockSpacing;
		}

		// 5. 裝備資料區塊（延伸到資訊區域底部）
		if (character.equipment && currentY < canvasHeight - 60) {
			const equipment = character.equipment;
			// 計算到資訊區域底部的剩餘高度
			const equipmentBlockHeight = canvasHeight - currentY - 60;
			const blockSpacing = 10; // 裝備區塊之間的間距
			const availableHeight = equipmentBlockHeight - blockSpacing * 3; // 3個間距
			const individualBlockHeight = availableHeight / 2; // 兩排，每排高度

			// 繪製四個裝備區塊
			const equipmentParts = [
				{
					name: "頭部裝備",
					key: "head",
					tid: "head_equip_tid",
					tier: "head_equip_tier",
					options: [
						"head_equip_option1_id",
						"head_equip_option2_id",
						"head_equip_option3_id"
					]
				},
				{
					name: "軀幹裝備",
					key: "torso",
					tid: "torso_equip_tid",
					tier: "torso_equip_tier",
					options: [
						"torso_equip_option1_id",
						"torso_equip_option2_id",
						"torso_equip_option3_id"
					]
				},
				{
					name: "手部裝備",
					key: "arm",
					tid: "arm_equip_tid",
					tier: "arm_equip_tier",
					options: [
						"arm_equip_option1_id",
						"arm_equip_option2_id",
						"arm_equip_option3_id"
					]
				},
				{
					name: "腿部裝備",
					key: "leg",
					tid: "leg_equip_tid",
					tier: "leg_equip_tier",
					options: [
						"leg_equip_option1_id",
						"leg_equip_option2_id",
						"leg_equip_option3_id"
					]
				}
			];

			let currentEquipmentY = currentY;
			const individualBlockWidth = (blockWidth - blockSpacing) / 2; // 兩列，每列寬度

			// 第一排：頭部裝備 + 軀幹裝備
			await DrawingUtils.drawSingleEquipmentBlock(
				ctx,
				leftMargin,
				currentEquipmentY,
				individualBlockWidth,
				individualBlockHeight,
				"頭部裝備",
				equipment,
				equipmentParts[0],
				character,
				accentColor
			);

			await DrawingUtils.drawSingleEquipmentBlock(
				ctx,
				leftMargin + individualBlockWidth + blockSpacing,
				currentEquipmentY,
				individualBlockWidth,
				individualBlockHeight,
				"軀幹裝備",
				equipment,
				equipmentParts[1],
				character,
				accentColor
			);

			currentEquipmentY += individualBlockHeight + blockSpacing;

			// 第二排：手部裝備 + 腿部裝備
			await DrawingUtils.drawSingleEquipmentBlock(
				ctx,
				leftMargin,
				currentEquipmentY,
				individualBlockWidth,
				individualBlockHeight,
				"手部裝備",
				equipment,
				equipmentParts[2],
				character,
				accentColor
			);

			await DrawingUtils.drawSingleEquipmentBlock(
				ctx,
				leftMargin + individualBlockWidth + blockSpacing,
				currentEquipmentY,
				individualBlockWidth,
				individualBlockHeight,
				"腿部裝備",
				equipment,
				equipmentParts[3],
				character,
				accentColor
			);
		}
	} catch (error) {
		logger.error(`無法生成角色詳細圖片: ${character.name_localkey.name}`, {
			error
		});
	}

	const buffer = canvas.toBuffer("image/png");

	// 釋放 Canvas 資源
	ResourceManager.releaseCanvas(canvas);

	return buffer;
}

// 處理玩家角色資料的輔助函數
function processUserCharacters(apiResponse: any): Character[] | null {
	if (!apiResponse || !apiResponse.data) {
		return null;
	}

	// 根據實際的 API 回應結構來處理
	// API 返回玩家擁有的角色，包含 combat, costume_id, grade, lv, name_code
	try {
		const characterList =
			apiResponse.data.character_list ||
			apiResponse.data.characters ||
			[];
		return characterList
			.map((char: any) => {
				// 根據 name_code 從 characters-tw.json 中找到對應的角色資料
				const characterData = characters.find(
					(c: any) => c.name_code === char.name_code
				);

				if (!characterData) {
					logger.warn(
						`找不到 name_code ${char.name_code} 對應的角色資料`
					);
					return null;
				}

				// 處理皮膚資料
				let costumeIndex: number | null = null;
				if (char.costume_id && char.costume_id > 0) {
					costumeIndex = getCostumeIndex(
						char.name_code,
						char.costume_id
					);
				}

				return {
					resource_id: characterData.resource_id,
					name_localkey: { name: characterData.name_localkey.name },
					original_rare: characterData.original_rare,
					class: characterData.class,
					element_id: characterData.element_id,
					shot_id: characterData.shot_id,
					use_burst_skill: characterData.use_burst_skill,
					corporation: characterData.corporation,
					// 玩家角色特有資料
					combat: char.combat || 0,
					costume_id: char.costume_id || 0,
					costume_index: costumeIndex,
					grade: char.grade || 0,
					core: char.core || 0,
					lv: char.lv || 1,
					name_code: char.name_code
				};
			})
			.filter(Boolean); // 過濾掉 null 值
	} catch (error) {
		logger.error("處理玩家角色資料失敗", { error });
		return null;
	}
}

export default {
	data: new SlashCommandBuilder()
		.setName("character")
		.setDescription("View character information")
		.setNameLocalizations({
			"zh-TW": "角色"
		})
		.setDescriptionLocalizations({
			"zh-TW": "查看角色資訊"
		})
		.addSubcommand(subcommand =>
			subcommand
				.setName("all")
				.setDescription("Show all characters")
				.setNameLocalizations({
					"zh-TW": "全部角色"
				})
				.setDescriptionLocalizations({
					"zh-TW": "顯示全部角色"
				})
				.addStringOption(option =>
					option
						.setName("account")
						.setDescription("Select the account")
						.setNameLocalizations({
							"zh-TW": "帳號"
						})
						.setDescriptionLocalizations({
							"zh-TW": "選擇帳號"
						})
						.setRequired(true)
						.setAutocomplete(true)
				)
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName("detail")
				.setDescription("Show detailed character information")
				.setNameLocalizations({
					"zh-TW": "角色詳情"
				})
				.setDescriptionLocalizations({
					"zh-TW": "顯示角色詳細資訊"
				})
				.addStringOption(option =>
					option
						.setName("account")
						.setDescription("Select the account")
						.setNameLocalizations({
							"zh-TW": "帳號"
						})
						.setDescriptionLocalizations({
							"zh-TW": "選擇帳號"
						})
						.setRequired(true)
						.setAutocomplete(true)
				)
				.addStringOption(option =>
					option
						.setName("character")
						.setDescription("Select the character")
						.setNameLocalizations({
							"zh-TW": "角色"
						})
						.setDescriptionLocalizations({
							"zh-TW": "選擇角色"
						})
						.setRequired(true)
						.setAutocomplete(true)
				)
		),

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const subcommand = interaction.options.getSubcommand();

		try {
			if (subcommand === "all") {
				await ErrorHandler.safeExecute(
					() => handleAllCharacters(interaction),
					null,
					`處理角色列表命令失敗: ${interaction.user.id}`
				);
			} else if (subcommand === "detail") {
				await ErrorHandler.safeExecute(
					() => handleCharacterDetail(interaction),
					null,
					`處理角色詳情命令失敗: ${interaction.user.id}`
				);
			}
		} catch (error) {
			logger.error(`命令執行失敗: ${subcommand}`, {
				error,
				userId: interaction.user.id
			});

			if (!interaction.replied && !interaction.deferred) {
				await interaction
					.reply({
						content: "❌ 命令執行時發生錯誤，請稍後再試",
						flags: MessageFlags.Ephemeral
					})
					.catch(() => {});
			} else if (interaction.deferred) {
				await interaction
					.editReply({
						content: "❌ 命令執行時發生錯誤，請稍後再試"
					})
					.catch(() => {});
			}
		}
	}
};

async function handleAllCharacters(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	const accountValue = interaction.options.getString("account", true);
	const [accountName, areaId] = accountValue.split("|");

	if (!accountName || !areaId) {
		await interaction.reply({
			content: "❌ 無效的帳號選擇",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	// 獲取用戶帳號資料
	const accounts = await databaseService.getUserAccounts(interaction.user.id);
	const selectedAccount = accounts.find(
		acc => acc.name === accountName && acc.nikke_area_id === areaId
	);

	if (!selectedAccount) {
		await interaction.reply({
			content: "❌ 找不到指定的帳號，請重新選擇",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	try {
		// 從 cookie 中提取 intl_open_id
		const cookieMatch = selectedAccount.cookie.match(/game_openid=([^;]+)/);
		if (!cookieMatch) {
			await interaction.reply({
				content: "❌ Cookie 中找不到 game_openid",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		const intl_open_id = cookieMatch[1];
		if (!intl_open_id) {
			await interaction.reply({
				content: "❌ 無法從 Cookie 中提取有效的 game_openid",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		const nikke_area_id = parseInt(areaId);

		await interaction.deferReply();

		// 獲取玩家角色資料
		const userCharactersResponse = await getUserCharacters(
			intl_open_id,
			nikke_area_id,
			selectedAccount.cookie
		);

		if (!userCharactersResponse) {
			await interaction.editReply({
				content: "❌ 無法獲取玩家角色資料，請確認帳號 Cookie 是否有效"
			});
			return;
		}

		// 處理 API 回應
		const userCharacters = processUserCharacters(userCharactersResponse);

		if (!userCharacters || userCharacters.length === 0) {
			await interaction.editReply({
				content: "❌ 玩家沒有角色資料或資料格式不正確"
			});
			return;
		}

		// 預設排序和篩選
		let currentSort: SortType = "combat";
		let currentFilters: FilterOptions = {
			classes: [],
			corporations: [],
			weaponTypes: [],
			elements: []
		};

		// 應用排序和篩選
		let filteredCharacters = filterCharacters(
			userCharacters,
			currentFilters
		);
		let sortedCharacters = sortCharacters(filteredCharacters, currentSort);

		// 生成玩家全部角色圖片（帶重試機制）
		const imageBuffer = await ErrorHandler.withRetry(
			() => generateUserCharactersImage(sortedCharacters),
			3,
			1000
		);

		if (!imageBuffer || !ErrorHandler.validateImageBuffer(imageBuffer)) {
			await interaction.editReply({
				content: "❌ 無法生成角色圖片，請稍後再試"
			});
			return;
		}

		const attachment = new AttachmentBuilder(imageBuffer, {
			name: `${accountName}_all_characters.png`
		});

		// 創建 SelectMenu 組件
		const sortMenu = createSortSelectMenu(currentSort);
		const filterMenu = createFilterSelectMenu(currentFilters);

		await interaction.editReply({
			content: `📋 ${accountName} 的全部角色 (${sortedCharacters.length}/${userCharacters.length} 個)`,
			files: [attachment],
			components: [sortMenu, filterMenu]
		});

		// 處理 SelectMenu 互動
		const collector = interaction.channel?.createMessageComponentCollector({
			componentType: ComponentType.StringSelect,
			time: 300000 // 5 分鐘
		});

		collector?.on("collect", async selectInteraction => {
			if (selectInteraction.user.id !== interaction.user.id) {
				await selectInteraction.reply({
					content: "❌ 只有指令使用者才能操作",
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			await selectInteraction.deferUpdate();

			if (selectInteraction.customId === "character_sort") {
				// 處理排序
				currentSort = selectInteraction.values[0] as SortType;
				sortedCharacters = sortCharacters(
					filteredCharacters,
					currentSort
				);
			} else if (selectInteraction.customId === "character_filter") {
				// 處理篩選
				currentFilters = parseFilterValues(selectInteraction.values);
				filteredCharacters = filterCharacters(
					userCharacters,
					currentFilters
				);
				sortedCharacters = sortCharacters(
					filteredCharacters,
					currentSort
				);
			}

			// 重新生成圖片
			const newImageBuffer =
				await generateUserCharactersImage(sortedCharacters);
			const newAttachment = new AttachmentBuilder(newImageBuffer, {
				name: `${accountName}_all_characters.png`
			});

			// 更新 SelectMenu
			const newSortMenu = createSortSelectMenu(currentSort);
			const newFilterMenu = createFilterSelectMenu(currentFilters);

			await selectInteraction.editReply({
				content: `-# 📋 指揮官 ${accountName} 的全部角色 (${sortedCharacters.length}/${userCharacters.length} 位)`,
				files: [newAttachment],
				components: [newSortMenu, newFilterMenu]
			});
		});

		collector?.on("end", () => {
			// 時間到後禁用組件
			const disabledSortMenu = createSortSelectMenu(currentSort);
			const disabledFilterMenu = createFilterSelectMenu(currentFilters);

			// 禁用所有選項
			if (disabledSortMenu.components[0]) {
				disabledSortMenu.components[0].setDisabled(true);
			}
			if (disabledFilterMenu.components[0]) {
				disabledFilterMenu.components[0].setDisabled(true);
			}

			interaction
				.editReply({
					components: [disabledSortMenu, disabledFilterMenu]
				})
				.catch(() => {});
		});
	} catch (error) {
		logger.error(`生成玩家全部角色圖片失敗: ${(error as Error).message}`);
		await interaction.editReply({
			content: "❌ 生成玩家全部角色圖片時發生錯誤，請稍後再試"
		});
	}
}

async function handleCharacterDetail(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	const accountValue = interaction.options.getString("account", true);
	const characterName = interaction.options.getString("character", true);
	const [accountName, areaId] = accountValue.split("|");

	if (!accountName || !areaId) {
		await interaction.reply({
			content: "❌ 無效的帳號選擇",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	// 獲取用戶帳號資料
	const accounts = await databaseService.getUserAccounts(interaction.user.id);
	const selectedAccount = accounts.find(
		acc => acc.name === accountName && acc.nikke_area_id === areaId
	);

	if (!selectedAccount) {
		await interaction.reply({
			content: "❌ 找不到指定的帳號，請重新選擇",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	try {
		// 從 cookie 中提取 intl_open_id
		const cookieMatch = selectedAccount.cookie.match(/game_openid=([^;]+)/);
		if (!cookieMatch) {
			await interaction.reply({
				content: "❌ Cookie 中找不到 game_openid",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		const intl_open_id = cookieMatch[1];
		if (!intl_open_id) {
			await interaction.reply({
				content: "❌ 無法從 Cookie 中提取有效的 game_openid",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		const nikke_area_id = parseInt(areaId);

		await interaction.deferReply();

		// 獲取玩家角色資料
		const userCharactersResponse = await getUserCharacters(
			intl_open_id,
			nikke_area_id,
			selectedAccount.cookie
		);

		if (!userCharactersResponse) {
			await interaction.editReply({
				content: "❌ 無法獲取玩家角色資料，請確認帳號 Cookie 是否有效"
			});
			return;
		}

		// 處理 API 回應
		const userCharacters = processUserCharacters(userCharactersResponse);

		if (!userCharacters || userCharacters.length === 0) {
			await interaction.editReply({
				content: "❌ 玩家沒有角色資料或資料格式不正確"
			});
			return;
		}

		// 查找選中的角色
		const selectedCharacter = userCharacters.find(
			char => char.name_localkey.name === characterName
		);

		if (!selectedCharacter) {
			await interaction.editReply({
				content: "❌ 找不到指定的角色，請重新選擇"
			});
			return;
		}

		// 獲取角色詳細資料
		const characterDetailsResponse = await getUserCharacterDetails(
			intl_open_id,
			nikke_area_id,
			[selectedCharacter.name_code!],
			selectedAccount.cookie
		);

		// 如果成功獲取詳細資料，則合併到角色資料中
		if (
			characterDetailsResponse &&
			characterDetailsResponse.data &&
			characterDetailsResponse.data.character_details
		) {
			const characterDetails =
				characterDetailsResponse.data.character_details[0];
			const stateEffects =
				characterDetailsResponse.data.state_effects || [];

			// 合併詳細資料到角色物件
			selectedCharacter.details = {
				arena_combat: characterDetails.arena_combat,
				arena_harmony_cube_lv: characterDetails.arena_harmony_cube_lv,
				arena_harmony_cube_tid: characterDetails.arena_harmony_cube_tid,
				attractive_lv: characterDetails.attractive_lv,
				combat: characterDetails.combat,
				core: characterDetails.core,
				costume_tid: characterDetails.costume_tid,
				favorite_item_lv: characterDetails.favorite_item_lv,
				favorite_item_tid: characterDetails.favorite_item_tid,
				grade: characterDetails.grade,
				harmony_cube_lv: characterDetails.harmony_cube_lv,
				harmony_cube_tid: characterDetails.harmony_cube_tid,
				lv: characterDetails.lv,
				name_code: characterDetails.name_code
			};

			// 合併裝備資料
			selectedCharacter.equipment = {
				arm_equip_corporation_type:
					characterDetails.arm_equip_corporation_type,
				arm_equip_lv: characterDetails.arm_equip_lv,
				arm_equip_option1_id: characterDetails.arm_equip_option1_id,
				arm_equip_option2_id: characterDetails.arm_equip_option2_id,
				arm_equip_option3_id: characterDetails.arm_equip_option3_id,
				arm_equip_tid: characterDetails.arm_equip_tid,
				arm_equip_tier: characterDetails.arm_equip_tier,
				head_equip_corporation_type:
					characterDetails.head_equip_corporation_type,
				head_equip_lv: characterDetails.head_equip_lv,
				head_equip_option1_id: characterDetails.head_equip_option1_id,
				head_equip_option2_id: characterDetails.head_equip_option2_id,
				head_equip_option3_id: characterDetails.head_equip_option3_id,
				head_equip_tid: characterDetails.head_equip_tid,
				head_equip_tier: characterDetails.head_equip_tier,
				leg_equip_corporation_type:
					characterDetails.leg_equip_corporation_type,
				leg_equip_lv: characterDetails.leg_equip_lv,
				leg_equip_option1_id: characterDetails.leg_equip_option1_id,
				leg_equip_option2_id: characterDetails.leg_equip_option2_id,
				leg_equip_option3_id: characterDetails.leg_equip_option3_id,
				leg_equip_tid: characterDetails.leg_equip_tid,
				leg_equip_tier: characterDetails.leg_equip_tier,
				torso_equip_corporation_type:
					characterDetails.torso_equip_corporation_type,
				torso_equip_lv: characterDetails.torso_equip_lv,
				torso_equip_option1_id: characterDetails.torso_equip_option1_id,
				torso_equip_option2_id: characterDetails.torso_equip_option2_id,
				torso_equip_option3_id: characterDetails.torso_equip_option3_id,
				torso_equip_tid: characterDetails.torso_equip_tid,
				torso_equip_tier: characterDetails.torso_equip_tier
			};

			// 合併技能資料
			selectedCharacter.skills = {
				skill1_lv: characterDetails.skill1_lv,
				skill2_lv: characterDetails.skill2_lv,
				ulti_skill_lv: characterDetails.ulti_skill_lv
			};

			// 合併狀態效果
			selectedCharacter.state_effects = stateEffects;
		}

		// 生成角色詳細圖片
		const imageBuffer =
			await generateCharacterDetailImage(selectedCharacter);
		const attachment = new AttachmentBuilder(imageBuffer, {
			name: `${characterName}_detail.png`
		});

		await interaction.editReply({
			files: [attachment]
		});
	} catch (error) {
		logger.error(
			`Character detail 指令執行失敗: ${(error as Error).message}`
		);
		await interaction.editReply({
			content: "❌ 獲取角色詳細資訊時發生錯誤，請稍後再試"
		});
	}
}
