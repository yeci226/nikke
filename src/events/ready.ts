import { Events, ActivityType } from "discord.js";
import { client, cluster } from "../index.js";
import * as schedule from "node-schedule";
import { createUrlFetcher } from "../utils/unifiedDownloader.js";
import { autoUpdater } from "../utils/autoUpdater.js";

async function updatePresence() {
	const results = await cluster.broadcastEval(
		(c: any) => c.guilds.cache.size
	);
	const totalGuilds = results.reduce(
		(prev: number, val: number) => prev + val,
		0
	);

	client.user?.setPresence({
		activities: [
			{ name: `${totalGuilds} 個伺服器`, type: ActivityType.Watching }
		],
		status: "online"
	});
}

// tw_url 更新功能
async function updateTwUrls() {
	try {
		const sources = [
			"https://raw.githubusercontent.com/IsolateOB/ExiaInvasion/b18be75c2b5ec7fd609952015fe5ed660543c063/fetch_nikke_list.ipynb"
		];

		const updater = createUrlFetcher(sources, "src/utils/tw_urls.json");
		const urls = await updater.fetchFromAllSources();
		console.log(`抓取到 ${urls.length} 个 tw_url`);
	} catch (error) {
		console.error("tw_url 更新失敗:", error);
	}
}

// 設定定時任務
function setupScheduledTasks() {
	// 每小時執行一次 tw_url 更新（保持原有功能）
	schedule.scheduleJob("0 * * * *", async () => {
		await updateTwUrls();
	});

	// 每天凌晨2點執行完整更新檢查
	schedule.scheduleJob("0 0 2 * * *", async () => {
		await autoUpdater.forceUpdateAll();
	});
}

client.on(Events.ClientReady, async () => {
	console.log(`${client.user?.tag} 已經上線！`);
	setInterval(updatePresence, 10000);
	setupScheduledTasks();
	autoUpdater.start();
	await updateTwUrls();
	await autoUpdater.forceUpdateAll();
});
