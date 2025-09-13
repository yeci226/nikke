import { Logger } from "./logger.js";

interface DatabaseConfig {
	path: string;
	backupInterval: number;
	maxConnections: number;
}

interface CacheConfig {
	maxSize: number;
	defaultTTL: number;
	cleanupInterval: number;
}

interface PerformanceConfig {
	monitoringInterval: number;
	memoryThreshold: number;
	enableGC: boolean;
}

interface LoggingConfig {
	level: string;
	enableFileLogging: boolean;
	logDirectory: string;
	maxLogFiles: number;
	maxLogSize: number;
}

interface BotConfig {
	maxLogsPerGuild: number;
	logRetentionDays: number;
	emojiCacheEnabled: boolean;
	autoCleanupInterval: number;
}

interface DevelopmentConfig {
	debugMode: boolean;
	enableHotReload: boolean;
	verboseLogging: boolean;
}

interface AppConfig {
	token: string;
	database: DatabaseConfig;
	cache: CacheConfig;
	performance: PerformanceConfig;
	logging: LoggingConfig;
	bot: BotConfig;
	development: DevelopmentConfig;
}

interface EnvironmentInfo {
	nodeVersion: string;
	platform: string;
	arch: string;
	env: string;
	pid: number;
}

class ConfigService {
	private logger: Logger;
	private config: AppConfig;

	constructor() {
		this.logger = new Logger("設定服務");
		this.config = this.loadConfig();
	}

	// 載入設定
	loadConfig(): AppConfig {
		try {
			// 從環境變數載入設定
			const config: AppConfig = {
				// Discord Bot Token
				token: process.env.DISCORD_TOKEN || "",

				// 資料庫設定
				database: {
					path: process.env.DB_PATH || "./data/database.sqlite",
					backupInterval: parseInt(
						process.env.DB_BACKUP_INTERVAL || "86400000"
					), // 24小時
					maxConnections: parseInt(
						process.env.DB_MAX_CONNECTIONS || "10"
					)
				},

				// 快取設定
				cache: {
					maxSize: parseInt(process.env.CACHE_MAX_SIZE || "1000"),
					defaultTTL: parseInt(
						process.env.CACHE_DEFAULT_TTL || "300000"
					), // 5分鐘
					cleanupInterval: parseInt(
						process.env.CACHE_CLEANUP_INTERVAL || "1800000"
					) // 30分鐘
				},

				// 效能監控設定
				performance: {
					monitoringInterval: parseInt(
						process.env.PERF_MONITORING_INTERVAL || "300000"
					), // 5分鐘
					memoryThreshold: parseInt(
						process.env.PERF_MEMORY_THRESHOLD || "500"
					), // MB
					enableGC: process.env.PERF_ENABLE_GC === "true"
				},

				// 日誌設定
				logging: {
					level: process.env.LOG_LEVEL || "info",
					enableFileLogging: process.env.LOG_ENABLE_FILE === "true",
					logDirectory: process.env.LOG_DIRECTORY || "./logs",
					maxLogFiles: parseInt(process.env.LOG_MAX_FILES || "10"),
					maxLogSize: parseInt(process.env.LOG_MAX_SIZE || "10485760") // 10MB
				},

				// bot特定設定
				bot: {
					maxLogsPerGuild: parseInt(
						process.env.BOT_MAX_LOGS_PER_GUILD || "10"
					),
					logRetentionDays: parseInt(
						process.env.BOT_LOG_RETENTION_DAYS || "30"
					),
					emojiCacheEnabled: process.env.BOT_EMOJI_CACHE === "true",
					autoCleanupInterval: parseInt(
						process.env.BOT_AUTO_CLEANUP_INTERVAL || "3600000"
					) // 1小時
				},

				// 開發環境設定
				development: {
					debugMode: process.env.DEBUG_MODE === "true",
					enableHotReload: process.env.HOT_RELOAD === "true",
					verboseLogging: process.env.VERBOSE_LOGGING === "true"
				}
			};

			this.logger.success("Bot設定載入完成");
			return config;
		} catch (error) {
			this.logger.error(`載入設定失敗: ${(error as Error).message}`);
			throw error;
		}
	}

	// 取得設定值
	get(key: string, defaultValue: any = null): any {
		const keys = key.split(".");
		let value: any = this.config;

		for (const k of keys) {
			if (value && typeof value === "object" && k in value) {
				value = value[k];
			} else {
				return defaultValue;
			}
		}

		return value !== undefined ? value : defaultValue;
	}

	// 設定值
	set(key: string, value: any): void {
		const keys = key.split(".");
		let current: any = this.config;

		for (let i = 0; i < keys.length - 1; i++) {
			const k = keys[i];
			if (!k) continue;
			if (!(k in current) || typeof current[k] !== "object") {
				current[k] = {};
			}
			current = current[k];
		}

		const lastKey = keys[keys.length - 1];
		if (lastKey) {
			current[lastKey] = value;
		}
		this.logger.info(`設定已更新: ${key} = ${value}`);
	}

	// 取得Discord Token
	getToken(): string {
		const token = this.get("token");
		if (!token) {
			throw new Error(
				"Discord Token 未設定，請檢查環境變數 DISCORD_TOKEN"
			);
		}
		return token;
	}

	// 取得資料庫設定
	getDatabaseConfig(): DatabaseConfig {
		return this.get("database", {});
	}

	// 取得快取設定
	getCacheConfig(): CacheConfig {
		return this.get("cache", {});
	}

	// 取得效能監控設定
	getPerformanceConfig(): PerformanceConfig {
		return this.get("performance", {});
	}

	// 取得日誌設定
	getLoggingConfig(): LoggingConfig {
		return this.get("logging", {});
	}

	// 取得Bot特定設定
	getBotConfig(): BotConfig {
		return this.get("bot", {});
	}

	// 檢查是否為開發環境
	isDevelopment(): boolean {
		return this.get("development.debugMode", false);
	}

	// 檢查是否啟用詳細日誌
	isVerboseLogging(): boolean {
		return this.get("development.verboseLogging", false);
	}

	// 驗證設定
	validateConfig(): boolean {
		const required = ["token"];
		const missing: string[] = [];

		for (const key of required) {
			if (!this.get(key)) {
				missing.push(key);
			}
		}

		if (missing.length > 0) {
			throw new Error(`缺少必要設定: ${missing.join(", ")}`);
		}

		this.logger.success("Bot設定驗證通過");
		return true;
	}

	// 取得所有設定
	getAllConfig(): AppConfig {
		return { ...this.config };
	}

	// 重載設定
	reload(): void {
		this.logger.info("重新載入Bot設定");
		this.config = this.loadConfig();
		this.validateConfig();
	}

	// 取得環境資訊
	getEnvironmentInfo(): EnvironmentInfo {
		return {
			nodeVersion: process.version,
			platform: process.platform,
			arch: process.arch,
			env: process.env.NODE_ENV || "development",
			pid: process.pid
		};
	}
}

export default new ConfigService();
