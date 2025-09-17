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

// Character 相關類型定義
export interface CharacterDetails {
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

export interface Character {
	resource_id: number;
	name_localkey: { name: string };
	original_rare: string;
	class: string;
	element_id: { element: { element: string } };
	shot_id: { element: { weapon_type: string } };
	use_burst_skill: string;
	corporation: string;
	costumes?: Array<{
		id: number;
		costume_index: number;
	}>;
	// 玩家角色特有屬性
	combat?: number;
	costume_id?: number;
	costume_index?: number | null;
	grade?: number;
	core?: number;
	lv?: number;
	name_code?: number;
	// 詳細資料
	details?: CharacterDetails;
	equipment?: any;
	skills?: any;
	state_effects?: any[];
}
