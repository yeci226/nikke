import {
	SlashCommandBuilder,
	ModalBuilder,
	TextInputBuilder,
	ActionRowBuilder,
	TextInputStyle,
	ChatInputCommandInteraction,
	AutocompleteInteraction,
	EmbedBuilder,
	MessageFlags
} from "discord.js";
import databaseService from "../services/database.js";
import { Logger } from "../services/logger.js";
import { areaNameMap } from "../utils/nikke.js";

export default {
	data: new SlashCommandBuilder()
		.setName("account")
		.setDescription("Link your Nikki account")
		.setNameLocalizations({
			"zh-TW": "帳號"
		})
		.setDescriptionLocalizations({
			"zh-TW": "綁定妮姬帳號"
		})
		.addSubcommand(subcommand =>
			subcommand
				.setName("setup")
				.setDescription("Link your Nikki account")
				.setNameLocalizations({
					"zh-TW": "設定帳號"
				})
				.setDescriptionLocalizations({
					"zh-TW": "綁定妮姬帳號"
				})
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName("list")
				.setDescription("View your linked accounts")
				.setNameLocalizations({
					"zh-TW": "帳號列表"
				})
				.setDescriptionLocalizations({
					"zh-TW": "查看已綁定的帳號"
				})
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName("delete")
				.setDescription("Delete your linked accounts")
				.setNameLocalizations({
					"zh-TW": "刪除帳號"
				})
				.setDescriptionLocalizations({
					"zh-TW": "刪除已綁定的帳號"
				})
				.addStringOption(option =>
					option
						.setName("account")
						.setDescription("Select the account to delete")
						.setNameLocalizations({
							"zh-TW": "帳號"
						})
						.setDescriptionLocalizations({
							"zh-TW": "選擇要刪除的帳號"
						})
						.setRequired(true)
						.setAutocomplete(true)
				)
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName("help")
				.setDescription("How to set up the game account")
				.setNameLocalizations({
					"zh-TW": "如何綁定"
				})
				.setDescriptionLocalizations({
					"zh-TW": "如何設定遊戲帳號"
				})
		),

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === "setup") {
			await handleSetupAccount(interaction);
		} else if (subcommand === "list") {
			await handleListAccounts(interaction);
		} else if (subcommand === "delete") {
			await handleDeleteAccount(interaction);
		} else if (subcommand === "help") {
			await handleHowToSetup(interaction);
		}
	}
};

// 處理如何設定帳號
async function handleHowToSetup(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	const embed = new EmbedBuilder()
		.setTitle("📋 如何設定遊戲帳號")
		.setDescription("請按照以下步驟設定指揮官的遊戲帳號：")
		.addFields(
			{
				name: "1️⃣ 獲取 Cookie",
				value: "前往 [blablalink.com](https://blablalink.com) 網站登入指揮官的妮姬帳號，登入後按 F12 開啟開發者工具，前往 Console，輸入 `document.cookie` 並按 Enter，複製 Cookie 欄位的完整內容。",
				inline: false
			},
			{
				name: "2️⃣ 必要參數",
				value: "Cookie 必須包含：\n`game_openid`, `game_channelid`, `game_gameid`, `game_token` 否則無法綁定妮姬帳號",
				inline: false
			},
			{
				name: "3️⃣ 設定帳號",
				value: "使用 `/帳號 設定帳號` 指令，然後貼上 Cookie。",
				inline: false
			},
			{
				name: "⚠️ 注意事項",
				value: "• Cookie 會用於驗證指揮官的遊戲身份\n• 請確保不要分享指揮官的 Cookie 給他人\n• 如果 Cookie 失效，需要重新設定",
				inline: false
			}
		)
		.setColor(0x00ff00)
		.setTimestamp();

	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// 處理設定帳號
async function handleSetupAccount(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	await interaction.showModal(
		new ModalBuilder()
			.setCustomId("account_setup_modal")
			.setTitle("設定遊戲帳號")
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId("cookie_input")
						.setLabel("請輸入指揮官的遊戲 Cookie")
						.setPlaceholder(
							"必須包含: game_openid, game_channelid, game_gameid, game_token"
						)
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true)
						.setMinLength(1)
						.setMaxLength(4000)
				)
			)
	);
}

// 處理列出已設定的帳號
async function handleListAccounts(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	const accounts = await databaseService.getUserAccounts(interaction.user.id);

	if (accounts.length === 0) {
		await interaction.reply({
			content:
				"❌ 指揮官還沒有設定任何妮姬帳號。\n\n使用 `/帳號 設定帳號` 來添加第一個妮姬帳號。",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const embed = new EmbedBuilder()
		.setTitle(`📋 指揮官已設定的妮姬帳號 (共 ${accounts.length}/5 個)`)
		.setColor(0x0099ff);

	accounts.forEach((account, index) => {
		embed.addFields({
			name: `${index + 1}. ${account.name} (${areaNameMap[account.nikke_area_id as unknown as keyof typeof areaNameMap]}服)`,
			value: "\u200b",
			inline: true
		});
	});

	await interaction.reply({
		content: "-# 💡 可以使用 `/帳號 刪除帳號` 刪除不需要的帳號",
		embeds: [embed],
		flags: MessageFlags.Ephemeral
	});
}

// 處理刪除帳號
async function handleDeleteAccount(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	const accountValue = interaction.options.getString("account", true);
	const [accountName, areaId] = accountValue.split("|");

	if (!accountName || !areaId) {
		await interaction.reply({
			content: "❌ 無效的帳號選擇",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	const success = await databaseService.removeUserAccount(
		interaction.user.id,
		accountName,
		areaId
	);

	if (success) {
		await interaction.reply({
			content: `✅ 已成功刪除帳號：**${accountName}** (${areaNameMap[areaId as unknown as keyof typeof areaNameMap]}服)`,
			flags: MessageFlags.Ephemeral
		});
	} else {
		await interaction.reply({
			content: "❌ 刪除帳號時發生錯誤，請重試",
			flags: MessageFlags.Ephemeral
		});
	}
}
