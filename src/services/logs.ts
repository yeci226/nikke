import { Guild, User } from "discord.js";
import { database } from "../index.js";

interface LogEntry {
	timestamp: string;
	userId: string;
	username: string;
	action: string;
	details: any;
}

async function addLogEntry(
	guild: Guild,
	user: User,
	action: string,
	details: any
): Promise<void> {
	const logEntry: LogEntry = {
		timestamp: new Date().toISOString(),
		userId: user.id,
		username: user.username,
		action: action,
		details: details
	};

	// Get existing logs or create new array
	let guildLogs =
		((await database.get(`${guild.id}.logs`)) as LogEntry[]) || [];

	// Add new log entry
	guildLogs.unshift(logEntry); // Add to start of array

	// Keep only last 100 entries to manage size
	if (guildLogs.length > 100) {
		guildLogs = guildLogs.slice(0, 100);
	}

	// Save logs
	await database.set(`${guild.id}.logs`, guildLogs);
}

export { addLogEntry };
