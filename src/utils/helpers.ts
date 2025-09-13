import { Logger } from "../services/logger.js";
import cacheService from "../services/cache.js";

const logger = new Logger("工具函數");

interface MemoryUsage {
	rss: string;
	heapUsed: string;
	heapTotal: string;
	external: string;
}

interface PerformanceResult<T> {
	result: T;
	duration: number;
}

interface SystemInfo {
	platform: string;
	arch: string;
	nodeVersion: string;
	pid: number;
	memory: MemoryUsage;
}

// 格式化時間
export function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}天 ${hours % 24}小時`;
	if (hours > 0) return `${hours}小時 ${minutes % 60}分鐘`;
	if (minutes > 0) return `${minutes}分鐘 ${seconds % 60}秒`;
	return `${seconds}秒`;
}

// 格式化檔案大小
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// 生成隨機ID
export function generateId(length: number = 8): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let result = "";
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

// 延遲函數
export function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// 重試函數
export async function retry<T>(
	fn: () => Promise<T>,
	maxAttempts: number = 3,
	delayMs: number = 1000
): Promise<T> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt === maxAttempts) {
				throw error;
			}
			logger.warn(
				`嘗試 ${attempt} 失敗，${delayMs}ms 後重試: ${(error as Error).message}`
			);
			await delay(delayMs);
		}
	}
	throw new Error("重試失敗");
}

// 批次處理
export async function batchProcess<T, R>(
	items: T[],
	processFn: (item: T) => Promise<R>,
	batchSize: number = 10
): Promise<R[]> {
	const results: R[] = [];

	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchPromises = batch.map(processFn);
		const batchResults = await Promise.allSettled(batchPromises);

		const validResults = batchResults
			.map(result =>
				result.status === "fulfilled" ? result.value : null
			)
			.filter((result): result is any => result !== null);
		results.push(...validResults);
	}

	return results;
}

// 記憶體使用監控
export function getMemoryUsage(): MemoryUsage {
	const usage = process.memoryUsage();
	return {
		rss: formatFileSize(usage.rss),
		heapUsed: formatFileSize(usage.heapUsed),
		heapTotal: formatFileSize(usage.heapTotal),
		external: formatFileSize(usage.external)
	};
}

// 效能測量
export async function measurePerformance<T>(
	fn: () => Promise<T>,
	name: string = "函數"
): Promise<PerformanceResult<T>> {
	const start = process.hrtime.bigint();
	const result = await fn();
	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1000000; // 轉換為毫秒

	logger.info(`${name} 執行時間: ${duration.toFixed(2)}ms`);
	return { result, duration };
}

// 快取包裝器
export function withCache<T extends (...args: any[]) => any>(
	fn: T,
	cacheKey: string | ((...args: Parameters<T>) => string),
	ttl: number = 300000
): T {
	return (async (...args: Parameters<T>) => {
		const key =
			typeof cacheKey === "function" ? cacheKey(...args) : cacheKey;
		const cached = cacheService.get(key);

		if (cached !== null) {
			return cached;
		}

		const result = await fn(...args);
		cacheService.set(key, result, ttl);
		return result;
	}) as T;
}

// 防抖函數
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): T {
	let timeout: NodeJS.Timeout;
	return ((...args: Parameters<T>) => {
		const later = () => {
			clearTimeout(timeout);
			func(...args);
		};
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
	}) as T;
}

// 節流函數
export function throttle<T extends (...args: any[]) => any>(
	func: T,
	limit: number
): T {
	let inThrottle: boolean;
	return ((...args: Parameters<T>) => {
		if (!inThrottle) {
			func(...args);
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	}) as T;
}

// 深度複製
export function deepClone<T>(obj: T): T {
	if (obj === null || typeof obj !== "object") return obj;
	if (obj instanceof Date) return new Date(obj.getTime()) as T;
	if (obj instanceof Array) return obj.map(item => deepClone(item)) as T;
	if (typeof obj === "object") {
		const clonedObj = {} as any;
		for (const key in obj) {
			if (obj.hasOwnProperty(key)) {
				clonedObj[key] = deepClone(obj[key]);
			}
		}
		return clonedObj;
	}
	return obj;
}

// 安全字串轉換
export function safeString(str: any): string {
	if (typeof str !== "string") return "";
	return str.replace(/[^\w\s-]/g, "").trim();
}

// 驗證電子郵件
export function isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}

// 驗證URL
export function isValidUrl(string: string): boolean {
	try {
		new URL(string);
		return true;
	} catch (_) {
		return false;
	}
}

// 取得環境變數
export function getEnvVar(
	key: string,
	defaultValue: string | null = null
): string | null {
	const value = process.env[key];
	return value !== undefined ? value : defaultValue;
}

// 檢查是否為開發環境
export function isDevelopment(): boolean {
	return process.env.NODE_ENV === "development";
}

// 檢查是否為生產環境
export function isProduction(): boolean {
	return process.env.NODE_ENV === "production";
}

// 取得系統資訊
export function getSystemInfo(): SystemInfo {
	return {
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.version,
		pid: process.pid,
		memory: getMemoryUsage()
	};
}
