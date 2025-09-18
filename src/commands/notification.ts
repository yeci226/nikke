import {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	PermissionFlagsBits,
	MessageFlags,
	ChannelType,
	EmbedBuilder
} from "discord.js";
import databaseService from "../services/database.js";
import { Logger } from "../services/logger.js";

const logger = new Logger("通知指令");

interface NotificationSettings {
	guildId: string;
	channelId: string;
	enabled: boolean;
	lastPostId?: string;
	createdAt: number;
	updatedAt: number;
}

export default {
	data: new SlashCommandBuilder()
		.setName("notification")
		.setDescription("Set NIKKE official notification")
		.setNameLocalizations({
			"zh-TW": "通知"
		})
		.setDescriptionLocalizations({
			"zh-TW": "設定 NIKKE 官方通知"
		})
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommand(subcommand =>
			subcommand
				.setName("setup")
				.setDescription("Set the notification channel")
				.setNameLocalizations({
					"zh-TW": "設定"
				})
				.setDescriptionLocalizations({
					"zh-TW": "設定通知頻道"
				})
				.addChannelOption(option =>
					option
						.setName("channel")
						.setDescription(
							"Select the channel to receive notifications"
						)
						.setNameLocalizations({
							"zh-TW": "頻道"
						})
						.setDescriptionLocalizations({
							"zh-TW": "選擇要接收通知的頻道"
						})
						.setRequired(true)
						.addChannelTypes(ChannelType.GuildText)
				)
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName("status")
				.setDescription("Check the current notification settings")
				.setNameLocalizations({
					"zh-TW": "狀態"
				})
				.setDescriptionLocalizations({
					"zh-TW": "查看目前通知設定"
				})
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName("disable")
				.setDescription("Disable the notification feature")
				.setNameLocalizations({
					"zh-TW": "關閉"
				})
				.setDescriptionLocalizations({
					"zh-TW": "關閉通知功能"
				})
		),

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const subcommand = interaction.options.getSubcommand();

		try {
			switch (subcommand) {
				case "setup":
					await handleSetup(interaction);
					break;
				case "status":
					await handleStatus(interaction);
					break;
				case "disable":
					await handleDisable(interaction);
					break;
				default:
					await interaction.reply({
						content: "❌ 無效的子指令",
						flags: MessageFlags.Ephemeral
					});
			}
		} catch (error) {
			logger.error(`通知指令執行失敗: ${subcommand}`, {
				error,
				userId: interaction.user.id,
				guildId: interaction.guildId
			});

			if (!interaction.replied && !interaction.deferred) {
				await interaction
					.reply({
						content: "❌ 指令執行時發生錯誤，請稍後再試",
						flags: MessageFlags.Ephemeral
					})
					.catch(() => {});
			} else if (interaction.deferred) {
				await interaction
					.editReply({
						content: "❌ 指令執行時發生錯誤，請稍後再試"
					})
					.catch(() => {});
			}
		}
	}
};

async function handleSetup(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	if (!interaction.guildId) {
		await interaction.reply({
			content: "❌ 此指令只能在伺服器中使用",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const channel = interaction.options.getChannel("頻道", true);

	if (!channel || channel.type !== ChannelType.GuildText) {
		await interaction.reply({
			content: "❌ 請選擇一個有效的文字頻道",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	// 檢查機器人是否有權限在該頻道發送訊息
	const botMember = interaction.guild?.members.me;
	if (!botMember) {
		await interaction.reply({
			content: "❌ 無法取得我的權限資訊",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	// 從 guild 中取得完整的頻道物件以檢查權限
	const guildChannel = interaction.guild?.channels.cache.get(channel.id);
	if (!guildChannel || guildChannel.type !== ChannelType.GuildText) {
		await interaction.reply({
			content: "❌ 無法取得頻道資訊",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const userPermissions = guildChannel.permissionsFor(interaction.user);
	if (!userPermissions?.has(PermissionFlagsBits.ManageGuild)) {
		await interaction.reply({
			content:
				"❌ 指揮官您沒有權限在這個頻道設定通知，需要 `管理伺服器` 權限",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const permissions = guildChannel.permissionsFor(botMember);
	if (
		!permissions?.has([
			PermissionFlagsBits.SendMessages,
			PermissionFlagsBits.ViewChannel
		])
	) {
		await interaction.reply({
			content: `❌ 我沒有權限在 ${guildChannel} 發送訊息，請檢查頻道權限設定`,
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	try {
		const settings: NotificationSettings = {
			guildId: interaction.guildId,
			channelId: channel.id,
			enabled: true,
			createdAt: Date.now(),
			updatedAt: Date.now()
		};

		const success = await setNotificationSettings(
			interaction.guildId,
			settings
		);

		if (success) {
			await interaction.reply({
				embeds: [
					new EmbedBuilder()
						.setColor(0x00ff00)
						.setTitle("✅ 通知設定成功")
						.setDescription(`NIKKE 官方通知已設定到 ${channel}`)
						.setFooter({ text: "NIKKE 通知系統" })
				],
				flags: MessageFlags.Ephemeral
			});

			logger.info(
				`伺服器 ${interaction.guildId} 設定通知到頻道 ${channel.id}`
			);
		} else {
			await interaction.reply({
				content: "❌ 設定通知時發生錯誤，請稍後再試",
				flags: MessageFlags.Ephemeral
			});
		}
	} catch (error) {
		logger.error("設定通知失敗", { error, guildId: interaction.guildId });
		await interaction.reply({
			content: "❌ 設定通知時發生錯誤，請稍後再試",
			flags: MessageFlags.Ephemeral
		});
	}
}

async function handleStatus(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	if (!interaction.guildId) {
		await interaction.reply({
			content: "❌ 此指令只能在伺服器中使用",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	try {
		const settings = await getNotificationSettings(interaction.guildId);

		if (!settings) {
			await interaction.reply({
				content:
					"❌ 尚未設定通知功能，請先使用 `/通知 設定` 來設定通知頻道",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		const channel = interaction.guild?.channels.cache.get(
			settings.channelId
		);
		const embed = new EmbedBuilder()
			.setColor(settings.enabled ? 0x00ff00 : 0xff0000)
			.setTitle("妮姬官方通知設定狀態")
			.addFields(
				{
					name: "頻道",
					value: channel ? `${channel}` : "頻道已被刪除",
					inline: true
				},
				{
					name: "狀態",
					value: settings.enabled ? "✅ 已啟用" : "❌ 已停用",
					inline: true
				},
				{
					name: "設定時間",
					value: `<t:${Math.floor(settings.createdAt / 1000)}:F>`,
					inline: false
				}
			)
			.setFooter({ text: "NIKKE 通知系統" });

		if (settings.lastPostId) {
			embed.addFields({
				name: "最後貼文 ID",
				value: settings.lastPostId,
				inline: true
			});
		}

		await interaction.reply({
			embeds: [embed],
			flags: MessageFlags.Ephemeral
		});
	} catch (error) {
		logger.error("查看通知狀態失敗", {
			error,
			guildId: interaction.guildId
		});
		await interaction.reply({
			content: "❌ 查看通知狀態時發生錯誤，請稍後再試",
			flags: MessageFlags.Ephemeral
		});
	}
}

async function handleDisable(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	if (!interaction.guildId) {
		await interaction.reply({
			content: "❌ 此指令只能在伺服器中使用",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const userPermissions = interaction.guild?.channels.cache
		.get(interaction.channelId)
		?.permissionsFor(interaction.user);
	if (!userPermissions?.has(PermissionFlagsBits.ManageGuild)) {
		await interaction.reply({
			content:
				"❌ 指揮官您沒有權限在這個頻道設定通知，需要 `管理伺服器` 權限",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	try {
		const settings = await getNotificationSettings(interaction.guildId);

		if (!settings) {
			await interaction.reply({
				content: "❌ 尚未設定通知功能",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		const success = await removeNotificationSettings(interaction.guildId);

		if (success) {
			const embed = new EmbedBuilder()
				.setColor(0xff9900)
				.setTitle("🔕 NIKKE 官方通知功能已關閉")
				.setFooter({ text: "NIKKE 通知系統" });

			await interaction.reply({
				embeds: [embed],
				flags: MessageFlags.Ephemeral
			});

			logger.info(`伺服器 ${interaction.guildId} 關閉通知功能`);
		} else {
			await interaction.reply({
				content: "❌ 關閉通知時發生錯誤，請稍後再試",
				flags: MessageFlags.Ephemeral
			});
		}
	} catch (error) {
		logger.error("關閉通知失敗", { error, guildId: interaction.guildId });
		await interaction.reply({
			content: "❌ 關閉通知時發生錯誤，請稍後再試",
			flags: MessageFlags.Ephemeral
		});
	}
}

// 資料庫操作函數
async function setNotificationSettings(
	guildId: string,
	settings: NotificationSettings
): Promise<boolean> {
	try {
		const db = databaseService.getDB();
		if (!db) return false;

		await db.set(`notification_${guildId}`, settings);
		return true;
	} catch (error) {
		logger.error("儲存通知設定失敗", { error, guildId });
		return false;
	}
}

async function getNotificationSettings(
	guildId: string
): Promise<NotificationSettings | null> {
	try {
		const db = databaseService.getDB();
		if (!db) return null;

		const settings = await db.get(`notification_${guildId}`);
		return (settings as NotificationSettings) || null;
	} catch (error) {
		logger.error("取得通知設定失敗", { error, guildId });
		return null;
	}
}

async function removeNotificationSettings(guildId: string): Promise<boolean> {
	try {
		const db = databaseService.getDB();
		if (!db) return false;

		await db.delete(`notification_${guildId}`);
		return true;
	} catch (error) {
		logger.error("刪除通知設定失敗", { error, guildId });
		return false;
	}
}

export { getNotificationSettings, setNotificationSettings };
