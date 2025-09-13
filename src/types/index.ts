import {
	Client,
	Collection,
	ChatInputCommandInteraction,
	Message,
	SlashCommandBuilder
} from "discord.js";
import { ClusterClient } from "discord-hybrid-sharding";
import { database } from "../index.js";

export type MessageCommand = {
	name: string;
	description: string;
	usage?: string;
	aliases?: string[];
	category?: string;
	cooldown?: number;
	args?: boolean;
	guildOnly?: boolean;

	/**
	 * @param message - 消息
	 * @param _args - 參數
	 * @returns
	 */
	execute: (message: Message, ..._args: string[]) => Promise<any>;
};

export type SlashCommand = {
	data: SlashCommandBuilder;

	/**
	 * @param interaction - 互動實例
	 * @param _args - 參數
	 * @returns
	 */
	execute: (
		interaction: ChatInputCommandInteraction,
		..._args: string[]
	) => Promise<any>;
};

// 扩展Discord.js Client类型
declare module "discord.js" {
	interface Client {
		db: typeof database;
		cluster: ClusterClient;
		commands: {
			slash: Collection<string, any>;
			message: Collection<string, any>;
		};
		emoji: Record<string, string>;
		loader: any;
	}
}

// 事件接口
export interface Event {
	name: string;
	once?: boolean;
	execute: (...args: any[]) => Promise<void> | void;
}

// 环境变量类型
export interface Environment {
	NODE_ENV: string;
	TOKEN: string;
	TESTOKEN: string;
	[key: string]: string;
}
