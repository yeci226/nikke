import { Logger } from "../services/logger.js";
import cacheService from "../services/cache.js";

const logger = new Logger("效能最佳化");

interface Metrics {
	startTime: number;
	operations: number;
	cacheHits: number;
	cacheMisses: number;
	errors: number;
}

interface PerformanceMetrics extends Metrics {
	uptime: string;
	opsPerSecond: string;
	errorRate: string;
}

interface MemoryInfo {
	rss: string;
	heapUsed: string;
	heapTotal: string;
	external: string;
}

// 效能最佳化工具類
export class PerformanceOptimizer {
	private metrics: Metrics;

	constructor() {
		this.metrics = {
			startTime: Date.now(),
			operations: 0,
			cacheHits: 0,
			cacheMisses: 0,
			errors: 0
		};
	}

	// 效能監控包裝器
	monitor<T extends (...args: any[]) => any>(
		fn: T,
		name: string = "函數"
	): T {
		return (async (...args: any[]) => {
			const start = process.hrtime.bigint();
			this.metrics.operations++;

			try {
				const result = await fn(...args);
				const end = process.hrtime.bigint();
				const duration = Number(end - start) / 1000000;

				logger.info(`${name} 執行完成，耗時: ${duration.toFixed(2)}ms`);
				return result;
			} catch (error) {
				this.metrics.errors++;
				logger.error(`${name} 執行失敗: ${(error as Error).message}`);
				throw error;
			}
		}) as T;
	}

	// 記憶體最佳化
	optimizeMemory(): void {
		const memUsage = process.memoryUsage();
		const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

		if (heapUsedMB > 500) {
			logger.warn(
				`記憶體使用過高: ${heapUsedMB.toFixed(2)}MB，執行垃圾回收`
			);

			// 清理快取
			cacheService.cleanup();

			// 強制垃圾回收
			if (global.gc) {
				global.gc();
				logger.info("已執行垃圾回收");
			}
		}
	}

	// 批次處理最佳化
	async batchProcess<T, R>(
		items: T[],
		processFn: (item: T) => Promise<R>,
		batchSize: number = 10,
		delayMs: number = 100
	): Promise<R[]> {
		const results: R[] = [];
		const batches: T[][] = [];

		// 分批
		for (let i = 0; i < items.length; i += batchSize) {
			batches.push(items.slice(i, i + batchSize));
		}

		logger.info(
			`開始批次處理 ${items.length} 個項目，共 ${batches.length} 批`
		);

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			if (!batch) continue;
			const batchPromises = batch.map(processFn);

			try {
				const batchResults = await Promise.allSettled(batchPromises);
				const validResults = batchResults
					.map(result =>
						result.status === "fulfilled" ? result.value : null
					)
					.filter((result): result is any => result !== null);
				results.push(...validResults);

				logger.info(`完成第 ${i + 1}/${batches.length} 批處理`);

				// 批次間延遲以避免過載
				if (i < batches.length - 1) {
					await new Promise(resolve => setTimeout(resolve, delayMs));
				}
			} catch (error) {
				logger.error(
					`批次 ${i + 1} 處理失敗: ${(error as Error).message}`
				);
			}
		}

		return results;
	}

	// 快取最佳化
	optimizeCache(): void {
		const stats = cacheService.getStats();
		const hitRate =
			stats.valid > 0
				? (this.metrics.cacheHits /
						(this.metrics.cacheHits + this.metrics.cacheMisses)) *
					100
				: 0;

		logger.info(`快取命中率: ${hitRate.toFixed(2)}%`);
		logger.info(`快取統計: ${JSON.stringify(stats)}`);

		// 如果命中率過低，調整快取策略
		if (hitRate < 50 && this.metrics.operations > 100) {
			logger.warn("快取命中率過低，建議調整快取策略");
		}
	}

	// 取得效能指標
	getMetrics(): PerformanceMetrics {
		const uptime = Date.now() - this.metrics.startTime;
		const opsPerSecond = this.metrics.operations / (uptime / 1000);

		return {
			...this.metrics,
			uptime: this.formatTime(uptime),
			opsPerSecond: opsPerSecond.toFixed(2),
			errorRate:
				this.metrics.operations > 0
					? (
							(this.metrics.errors / this.metrics.operations) *
							100
						).toFixed(2)
					: "0"
		};
	}

	// 格式化時間
	formatTime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) return `${hours}小時 ${minutes % 60}分鐘`;
		if (minutes > 0) return `${minutes}分鐘 ${seconds % 60}秒`;
		return `${seconds}秒`;
	}

	// 重設指標
	resetMetrics(): void {
		this.metrics = {
			startTime: Date.now(),
			operations: 0,
			cacheHits: 0,
			cacheMisses: 0,
			errors: 0
		};
		logger.info("效能指標已重設");
	}
}

// 建立全域最佳化器實例
export const optimizer = new PerformanceOptimizer();

// 效能最佳化工具函數
export const optimizationUtils = {
	// 防抖最佳化
	debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
		let timeout: NodeJS.Timeout;
		return ((...args: any[]) => {
			const later = () => {
				clearTimeout(timeout);
				func(...args);
			};
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
		}) as T;
	},

	// 節流最佳化
	throttle<T extends (...args: any[]) => any>(func: T, limit: number): T {
		let inThrottle: boolean;
		return ((...args: any[]) => {
			if (!inThrottle) {
				func(...args);
				inThrottle = true;
				setTimeout(() => (inThrottle = false), limit);
			}
		}) as T;
	},

	// 非同步佇列處理
	async queueProcessor<T, R>(
		items: T[],
		processFn: (item: T) => Promise<R>,
		concurrency: number = 5
	): Promise<R[]> {
		const queue = [...items];
		const results: R[] = [];
		const running = new Set<Promise<R>>();

		const processNext = async (): Promise<void> => {
			if (queue.length === 0) return;

			const item = queue.shift()!;
			const promise = processFn(item);
			running.add(promise);

			try {
				const result = await promise;
				results.push(result);
			} catch (error) {
				logger.error(`佇列處理項目失敗: ${(error as Error).message}`);
				results.push(null as R);
			} finally {
				running.delete(promise);
				if (queue.length > 0) {
					processNext();
				}
			}
		};

		// 啟動並行處理
		const workers = Array.from({ length: concurrency }, () =>
			processNext()
		);
		await Promise.all(workers);

		return results;
	},

	// 記憶體使用監控
	getMemoryInfo(): MemoryInfo {
		const usage = process.memoryUsage();
		return {
			rss: `${(usage.rss / 1024 / 1024).toFixed(2)}MB`,
			heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
			heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
			external: `${(usage.external / 1024 / 1024).toFixed(2)}MB`
		};
	},

	// 效能警告檢查
	checkPerformanceWarnings(): string[] {
		const memUsage = process.memoryUsage();
		const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

		const warnings: string[] = [];

		if (heapUsedMB > 500) {
			warnings.push(`記憶體使用過高: ${heapUsedMB.toFixed(2)}MB`);
		}

		const metrics = optimizer.getMetrics();
		if (parseFloat(metrics.errorRate) > 5) {
			warnings.push(`錯誤率過高: ${metrics.errorRate}%`);
		}

		return warnings;
	}
};
