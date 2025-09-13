import { client, commands, database } from "../index.js";
import databaseService from "../services/database.js";
import {
	getUserGamePlayerInfo,
	extractAccountInfo
} from "../utils/apiHelper.js";
import {
	ApplicationCommandOptionType,
	Events,
	EmbedBuilder,
	WebhookClient,
	ChannelType,
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	MessageFlags,
	ModalSubmitInteraction
} from "discord.js";
import { Logger } from "../services/logger.js";
import { areaNameMap } from "../utils/nikke.js";
const webhook = new WebhookClient({ url: process.env.CMDWEBHOOK! });

// Handle autocomplete interactions
async function handleAutocomplete(
	interaction: AutocompleteInteraction
): Promise<void> {
	try {
		const focusedValue = interaction.options.getFocused();
		const accounts = await databaseService.getUserAccounts(
			interaction.user.id
		);

		const filtered = accounts
			.filter(
				account =>
					account.name
						.toLowerCase()
						.includes(focusedValue.toLowerCase()) ||
					account.nikke_area_id.includes(focusedValue)
			)
			.slice(0, 25)
			.map(account => {
				const areaId =
					account.nikke_area_id as unknown as keyof typeof areaNameMap;
				const areaName = areaNameMap[areaId] || account.nikke_area_id;
				return {
					name: `${account.name} (${areaName}服)`,
					value: `${account.name}|${account.nikke_area_id}`
				};
			});

		await interaction.respond(filtered);
	} catch (error) {
		console.error("Autocomplete error:", error);
		await interaction.respond([]);
	}
}

// Handle slash commands
async function handleSlashCommand(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	const command = commands.slash.get(interaction.commandName);
	if (!command) {
		await interaction.followUp({
			content: "An error has occurred",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const args = interaction.options.data.reduce((acc: string[], option) => {
		if (option.type === ApplicationCommandOptionType.Subcommand) {
			if (option.name) acc.push(option.name);
			option.options?.forEach(x => {
				if (x.value) acc.push(String(x.value));
			});
		} else if (option.value) {
			acc.push(String(option.value));
		}
		return acc;
	}, []);

	try {
		await command.execute(
			interaction as ChatInputCommandInteraction,
			...args
		);
		logCommandExecution(interaction, command);
	} catch (error) {
		console.error("Command execution error:", error);
		new Logger("指令").error(`錯誤訊息：${(error as Error).message}`);

		if (!interaction.replied && !interaction.deferred) {
			await interaction.reply({
				content: "哦喲，好像出了一點小問題，請重試",
				flags: MessageFlags.Ephemeral
			});
		}
	}
}

// Handle modal submissions
async function handleModalSubmit(
	interaction: ModalSubmitInteraction
): Promise<void> {
	try {
		if (
			interaction.customId === "cookie_modal" ||
			interaction.customId === "account_setup_modal"
		) {
			const cookieValue =
				interaction.fields.getTextInputValue("cookie_input");

			// 驗證 cookie 是否包含必要的遊戲參數
			const requiredParams = [
				"game_openid",
				"game_channelid",
				"game_gameid",
				"game_token"
			];
			const missingParams = requiredParams.filter(
				param => !cookieValue.includes(param)
			);

			if (missingParams.length > 0) {
				await interaction.reply({
					content: `❌ Cookie 格式不正確！缺少必要參數：\n\`${missingParams.join(", ")}\`\n\n請確保指揮官的 cookie 包含所有必要的遊戲參數。`,
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			// 使用 API 驗證 cookie 並獲取遊戲資料
			await interaction.reply({
				content: "🔄 正在驗證 cookie 並獲取遊戲資料...",
				flags: MessageFlags.Ephemeral
			});

			const gameInfo = await getUserGamePlayerInfo(cookieValue);

			if (!gameInfo) {
				await interaction.editReply({
					content:
						"❌ Cookie 驗證失敗！請檢查 cookie 是否有效或網路連線是否正常。"
				});
				return;
			}

			// 提取帳戶資訊
			const accountInfo = extractAccountInfo(gameInfo, cookieValue);

			// 使用新的帳戶管理方式儲存
			const result = await databaseService.addUserAccount(
				interaction.user.id,
				accountInfo
			);

			if (result.success) {
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setColor(0x0099ff)
							.setTitle(`✅ ${result.message}！`)
							.addFields([
								{
									name: "角色名稱",
									value: accountInfo.name,
									inline: false
								},
								{
									name: "伺服器",
									value:
										areaNameMap[
											accountInfo.nikke_area_id as unknown as keyof typeof areaNameMap
										] || accountInfo.nikke_area_id,
									inline: false
								},
								{
									name: "玩家等級",
									value: gameInfo.data.player_level.toString(),
									inline: false
								}
							])
					]
				});

				new Logger("Cookie").info(
					`用戶 ${interaction.user.username}(${interaction.user.id}) ${result.message}: ${accountInfo.name} (${accountInfo.nikke_area_id})`
				);
			} else {
				await interaction.editReply({
					content: result.message
				});
			}
		}
	} catch (error) {
		console.error("Modal submission error:", error);
		new Logger("Modal").error(`錯誤訊息：${(error as Error).message}`);

		// 檢查是否已經回覆過
		if (!interaction.replied && !interaction.deferred) {
			try {
				await interaction.reply({
					content: "❌ 處理 cookie 綁定時發生錯誤，請重試",
					flags: MessageFlags.Ephemeral
				});
			} catch (replyError) {
				console.error("Failed to reply to interaction:", replyError);
			}
		} else if (interaction.deferred) {
			try {
				await interaction.editReply({
					content: "❌ 處理 cookie 綁定時發生錯誤，請重試"
				});
			} catch (editError) {
				console.error("Failed to edit reply:", editError);
			}
		}
	}
}

// Log command execution
function logCommandExecution(
	interaction: ChatInputCommandInteraction,
	command: any
): void {
	const executionTime = (
		(Date.now() - interaction.createdTimestamp) /
		1000
	).toFixed(2);
	const timeString = `花費 ${executionTime} 秒`;

	new Logger("指令").info(
		`${interaction.user.displayName}(${interaction.user.id}) 執行 ${command.data.name} - ${timeString}`
	);

	const embedFields = {
		name: command.data.name,
		value: [
			(interaction.options as any)._subcommand
				? `> ${(interaction.options as any)._subcommand}`
				: "\u200b",
			(interaction.options as any)._hoistedOptions?.length > 0
				? ` \`${(interaction.options as any)._hoistedOptions[0].value}\``
				: "\u200b"
		].join(""),
		inline: true
	};

	webhook.send({
		embeds: [
			new EmbedBuilder()
				.setColor(null)
				.setFooter({ text: timeString })
				.setTimestamp()
				.setAuthor({
					iconURL: interaction.user.displayAvatarURL({
						size: 4096
					}),
					name: `${interaction.user.username} - ${interaction.user.id}`
				})
				.setThumbnail(
					interaction.guild?.iconURL({
						size: 4096,
						forceStatic: false
					}) || null
				)
				.setDescription(
					`\`\`\`${interaction.guild?.name} - ${interaction.guild?.id}\`\`\``
				)
				.addFields(embedFields)
		]
	});
}

// Main interaction handler
client.on(Events.InteractionCreate, async (interaction: any) => {
	if (interaction.channel?.type === ChannelType.DM) return;

	try {
		if (interaction.isAutocomplete()) {
			await handleAutocomplete(interaction);
		} else if (interaction.isButton()) {
			await interaction.deferUpdate().catch(() => {});
		} else if (interaction.isCommand()) {
			await handleSlashCommand(interaction);
		} else if (interaction.isContextMenuCommand()) {
			const command = client.commands.slash.get(
				(interaction as any).commandName
			);
			if (command) {
				await command.execute(client, interaction);
			}
		} else if (interaction.isModalSubmit()) {
			await handleModalSubmit(interaction);
		}
	} catch (error) {
		console.error("Interaction handling error:", error);
	}
});
