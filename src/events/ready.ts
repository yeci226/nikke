import { Events, ActivityType } from "discord.js";
import { client, cluster } from "../index.js";
import * as schedule from "node-schedule";
import { updateManager } from "../utils/updateManager.js";

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

async function updateTwUrls() {
	try {
		// 使用新的統一更新管理器
		await updateManager.forceUpdate("url-monitor");
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
		await updateManager.forceUpdateAll();
	});
}

client.on(Events.ClientReady, async () => {
	console.log(`${client.user?.tag} 已經上線！`);
	setInterval(updatePresence, 10000);
	setupScheduledTasks();
	updateManager.start(); // 啟動統一更新管理器
	await updateTwUrls();
});
