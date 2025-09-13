import { Logger } from "./logger.js";
import cacheService from "./cache.js";
import { database } from "../index.js";

interface LogData {
	timestamp: number;
	id: string;
	[key: string]: any;
}

interface BotConfig {
	maxLogsPerGuild: number;
	logRetentionDays: number;
	autoCleanupInterval: number;
}

interface LogsStructure {
	version: string;
	created: number;
	guilds: Record<string, any>;
}

interface EmojiCache {
	version: string;
	created: number;
	cache: Record<
		string,
		{
			data: any;
			timestamp: number;
		}
	>;
}

interface PaginatedLogs {
	logs: LogData[];
	total: number;
	limit: number;
	offset: number;
}

interface DatabaseStats {
	totalLogs: number;
	totalGuilds: number;
	emojiCacheSize: number;
	cacheSize: number;
}

interface UserCookie {
	cookie: string;
	userId: string;
	username: string;
	boundAt: number;
	guildId: string | null;
}

interface AccountInfo {
	name: string;
	nikke_area_id: string;
	cookie: string;
}

class DatabaseService {
	private logger: Logger;
	private botConfig: BotConfig;

	constructor() {
		this.logger = new Logger("資料庫");
		this.botConfig = {
			maxLogsPerGuild: 10,
			logRetentionDays: 30,
			autoCleanupInterval: 3600000
		};
	}

	getDB(): typeof database | null {
		return database;
	}

	// Bot特定的日誌管理方法
	async addLog(
		guildId: string,
		logData: Omit<LogData, "timestamp" | "id">
	): Promise<string | null> {
		try {
			const logs =
				((await database.get(`logs_${guildId}`)) as LogData[]) || [];

			// 新增時間戳
			const fullLogData: LogData = {
				...logData,
				timestamp: Date.now(),
				id: this.generateLogId()
			};

			logs.push(fullLogData);

			// 限制日誌數量
			if (logs.length > this.botConfig.maxLogsPerGuild) {
				logs.splice(0, logs.length - this.botConfig.maxLogsPerGuild);
			}

			await database.set(`logs_${guildId}`, logs);

			// 快取最新的日誌
			cacheService.set(`logs_${guildId}_latest`, logs.slice(-5), 300000); // 5分鐘快取

			return fullLogData.id;
		} catch (error) {
			this.logger.error(
				`新增日誌失敗 (Guild: ${guildId}): ${(error as Error).message}`
			);
			return null;
		}
	}

	async getLogs(
		guildId: string,
		limit: number = 10,
		offset: number = 0
	): Promise<PaginatedLogs> {
		try {
			const cacheKey = `logs_${guildId}_${limit}_${offset}`;
			const cached = cacheService.get(cacheKey);
			if (cached !== null) {
				return cached as PaginatedLogs;
			}

			const logs =
				((await database.get(`logs_${guildId}`)) as LogData[]) || [];
			const paginatedLogs = logs.slice(offset, offset + limit);

			const result: PaginatedLogs = {
				logs: paginatedLogs,
				total: logs.length,
				limit,
				offset
			};

			// 快取結果（短期快取）
			cacheService.set(cacheKey, result, 60000); // 1分鐘快取

			return result;
		} catch (error) {
			this.logger.error(
				`取得日誌失敗 (Guild: ${guildId}): ${(error as Error).message}`
			);
			return { logs: [], total: 0, limit, offset };
		}
	}

	async removeLog(guildId: string, logId: string): Promise<boolean> {
		try {
			const logs =
				((await database.get(`logs_${guildId}`)) as LogData[]) || [];
			const filteredLogs = logs.filter(log => log.id !== logId);

			await database.set(`logs_${guildId}`, filteredLogs);

			// 清除相關快取
			cacheService.delete(`logs_${guildId}_latest`);

			return true;
		} catch (error) {
			this.logger.error(
				`刪除日誌失敗 (Guild: ${guildId}, Log: ${logId}): ${(error as Error).message}`
			);
			return false;
		}
	}

	async clearLogs(guildId: string): Promise<boolean> {
		try {
			await database.delete(`logs_${guildId}`);

			// 清除相關快取
			cacheService.delete(`logs_${guildId}_latest`);

			return true;
		} catch (error) {
			this.logger.error(
				`清空日誌失敗 (Guild: ${guildId}): ${(error as Error).message}`
			);
			return false;
		}
	}

	// Emoji快取管理
	async cacheEmoji(guildId: string, emojiData: any): Promise<boolean> {
		try {
			const emojiCache = ((await database.get(
				"emoji_cache"
			)) as EmojiCache) || {
				cache: {}
			};
			emojiCache.cache[guildId] = {
				data: emojiData,
				timestamp: Date.now()
			};

			await database.set("emoji_cache", emojiCache);

			return true;
		} catch (error) {
			this.logger.error(
				`快取Emoji失敗 (Guild: ${guildId}): ${(error as Error).message}`
			);
			return false;
		}
	}

	async getCachedEmoji(guildId: string): Promise<any | null> {
		try {
			const emojiCache = (await database.get(
				"emoji_cache"
			)) as EmojiCache;
			if (!emojiCache || !emojiCache.cache[guildId]) {
				return null;
			}

			const cached = emojiCache.cache[guildId];
			const now = Date.now();

			// 檢查是否過期（24小時）
			if (now - cached.timestamp > 86400000) {
				delete emojiCache.cache[guildId];
				await database.set("emoji_cache", emojiCache);
				return null;
			}

			return cached.data;
		} catch (error) {
			this.logger.error(
				`取得快取的Emoji失敗 (Guild: ${guildId}): ${(error as Error).message}`
			);
			return null;
		}
	}

	// 產生日誌ID
	generateLogId(): string {
		return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	// 取得資料庫統計
	async getStats(): Promise<DatabaseStats> {
		try {
			const logsStructure = (await database.get(
				"logs_structure"
			)) as LogsStructure;
			const emojiCache = (await database.get(
				"emoji_cache"
			)) as EmojiCache;

			let totalLogs = 0;
			let totalGuilds = 0;

			if (logsStructure && logsStructure.guilds) {
				totalGuilds = Object.keys(logsStructure.guilds).length;

				for (const guildId in logsStructure.guilds) {
					const logs =
						((await database.get(
							`logs_${guildId}`
						)) as LogData[]) || [];
					totalLogs += logs.length;
				}
			}

			return {
				totalLogs,
				totalGuilds,
				emojiCacheSize: emojiCache
					? Object.keys(emojiCache.cache).length
					: 0,
				cacheSize: cacheService.getSize()
			};
		} catch (error) {
			this.logger.error(
				`取得資料庫統計失敗: ${(error as Error).message}`
			);
			return {
				totalLogs: 0,
				totalGuilds: 0,
				emojiCacheSize: 0,
				cacheSize: 0
			};
		}
	}

	// Cookie 管理方法
	async setUserCookie(
		userId: string,
		cookieData: Omit<UserCookie, "userId">
	): Promise<boolean> {
		try {
			const fullCookieData: UserCookie = {
				...cookieData,
				userId
			};

			await database.set(`user_cookie_${userId}`, fullCookieData);
			this.logger.info(`用戶 ${userId} 的 cookie 已儲存`);
			return true;
		} catch (error) {
			this.logger.error(
				`儲存用戶 cookie 失敗 (User: ${userId}): ${(error as Error).message}`
			);
			return false;
		}
	}

	async getUserCookie(userId: string): Promise<UserCookie | null> {
		try {
			// 先檢查快取
			const cached = cacheService.get(`user_cookie_${userId}`);
			if (cached !== null) {
				return cached as UserCookie;
			}

			const cookieData = (await database.get(
				`user_cookie_${userId}`
			)) as UserCookie;

			if (cookieData) {
				// 快取結果
				cacheService.set(`user_cookie_${userId}`, cookieData, 300000); // 5分鐘快取
			}

			return cookieData || null;
		} catch (error) {
			this.logger.error(
				`取得用戶 cookie 失敗 (User: ${userId}): ${(error as Error).message}`
			);
			return null;
		}
	}

	async deleteUserCookie(userId: string): Promise<boolean> {
		try {
			await database.delete(`user_cookie_${userId}`);

			// 清除快取
			cacheService.delete(`user_cookie_${userId}`);

			this.logger.info(`用戶 ${userId} 的 cookie 已刪除`);
			return true;
		} catch (error) {
			this.logger.error(
				`刪除用戶 cookie 失敗 (User: ${userId}): ${(error as Error).message}`
			);
			return false;
		}
	}

	async getAllUserCookies(): Promise<UserCookie[]> {
		try {
			const allData = await database.all();
			const cookieKeys = allData
				.filter((item: { id: string; value: any }) =>
					item.id.startsWith("user_cookie_")
				)
				.map((item: { id: string; value: any }) => item.id);
			const cookies: UserCookie[] = [];

			for (const key of cookieKeys) {
				const cookieData = (await database.get(key)) as UserCookie;
				if (cookieData) {
					cookies.push(cookieData);
				}
			}

			return cookies;
		} catch (error) {
			this.logger.error(
				`取得所有用戶 cookie 失敗: ${(error as Error).message}`
			);
			return [];
		}
	}

	// 新的帳戶管理方法
	async addUserAccount(
		userId: string,
		accountInfo: AccountInfo
	): Promise<{ success: boolean; message: string }> {
		try {
			const accounts =
				((await database.get(`${userId}.accounts`)) as AccountInfo[]) ||
				[];

			// 檢查是否已存在相同的帳戶（根據 name 和 nikke_area_id）
			const existingIndex = accounts.findIndex(
				account =>
					account.name === accountInfo.name &&
					account.nikke_area_id === accountInfo.nikke_area_id
			);

			if (existingIndex >= 0) {
				// 更新現有帳戶的 cookie
				accounts[existingIndex] = accountInfo;
				await database.set(`${userId}.accounts`, accounts);

				this.logger.info(
					`用戶 ${userId} 的帳戶已更新: ${accountInfo.name} (${accountInfo.nikke_area_id})`
				);
				return { success: true, message: "帳戶已更新" };
			} else {
				// 檢查是否已達到最大帳戶數量限制
				if (accounts.length >= 5) {
					return {
						success: false,
						message:
							"❌ 最多只能綁定 5 個帳號！請先刪除不需要的帳號再添加新帳號。"
					};
				}

				// 添加新帳戶
				accounts.push(accountInfo);
				await database.set(`${userId}.accounts`, accounts);

				this.logger.info(
					`用戶 ${userId} 的帳戶已添加: ${accountInfo.name} (${accountInfo.nikke_area_id})`
				);
				return { success: true, message: "帳戶已添加" };
			}
		} catch (error) {
			this.logger.error(
				`添加用戶帳戶失敗 (User: ${userId}): ${(error as Error).message}`
			);
			return { success: false, message: "添加帳戶時發生錯誤，請重試" };
		}
	}

	async getUserAccounts(userId: string): Promise<AccountInfo[]> {
		try {
			const accounts =
				((await database.get(`${userId}.accounts`)) as AccountInfo[]) ||
				[];

			return accounts;
		} catch (error) {
			this.logger.error(
				`取得用戶帳戶失敗 (User: ${userId}): ${(error as Error).message}`
			);
			return [];
		}
	}

	async removeUserAccount(
		userId: string,
		accountName: string,
		areaId: string
	): Promise<boolean> {
		try {
			const accounts =
				((await database.get(`${userId}.accounts`)) as AccountInfo[]) ||
				[];
			const filteredAccounts = accounts.filter(
				account =>
					!(
						account.name === accountName &&
						account.nikke_area_id === areaId
					)
			);

			await database.set(`${userId}.accounts`, filteredAccounts);

			this.logger.info(
				`用戶 ${userId} 的帳戶已刪除: ${accountName} (${areaId})`
			);
			return true;
		} catch (error) {
			this.logger.error(
				`刪除用戶帳戶失敗 (User: ${userId}): ${(error as Error).message}`
			);
			return false;
		}
	}

	async clearUserAccounts(userId: string): Promise<boolean> {
		try {
			await database.delete(`${userId}.accounts`);

			this.logger.info(`用戶 ${userId} 的所有帳戶已清除`);
			return true;
		} catch (error) {
			this.logger.error(
				`清除用戶帳戶失敗 (User: ${userId}): ${(error as Error).message}`
			);
			return false;
		}
	}
}

export default new DatabaseService();
