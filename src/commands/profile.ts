import {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	AttachmentBuilder,
	MessageFlags
} from "discord.js";
import databaseService from "../services/database.js";
import { Logger } from "../services/logger.js";
import {
	getUserProfileBasicInfo,
	getUserProfileOutpostInfo,
	getUserDailyContentsProgress
} from "../utils/nikke.js";
import {
	generateProfileImage,
	createProfileDataFromApi
} from "../utils/profile.js";
import emoji from "../assets/emoji.json" with { type: "json" };

const logger = new Logger();

/**
 * 格式化數字為易讀格式 (K, M, B)
 */
function formatNumber(num: number): string {
	if (num >= 1000000000) {
		return (num / 1000000000).toFixed(1).replace(/\.0$/, "") + "B";
	}
	if (num >= 1000000) {
		return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
	}
	if (num >= 1000) {
		return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
	}
	return num.toString();
}

export default {
	data: new SlashCommandBuilder()
		.setName("profile")
		.setDescription("View your Nikki personal information")
		.setNameLocalizations({
			"zh-TW": "個人簡介"
		})
		.setDescriptionLocalizations({
			"zh-TW": "查看妮姬個人簡介"
		})
		.addStringOption(option =>
			option
				.setName("account")
				.setDescription(
					"Select the account to view profile information"
				)
				.setNameLocalizations({
					"zh-TW": "帳號"
				})
				.setDescriptionLocalizations({
					"zh-TW": "選擇要查看的帳號"
				})
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addBooleanOption(option =>
			option
				.setName("currencies")
				.setDescription(
					"Whether to display the currencies (credits etc.)"
				)
				.setNameLocalizations({
					"zh-TW": "顯示資源"
				})
				.setDescriptionLocalizations({
					"zh-TW": "是否顯示擁有的資源 (信用點等)"
				})
				.setRequired(false)
		),
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const accountValue = interaction.options.getString("account", true);
		const [accountName, areaId] = accountValue.split("|");
		const currencies = interaction.options.getBoolean("currencies", false);

		if (!accountName || !areaId) {
			await interaction.reply({
				content: "❌ 無效的帳號選擇",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		// 獲取用戶帳號資料
		const accounts = await databaseService.getUserAccounts(
			interaction.user.id
		);
		const selectedAccount = accounts.find(
			acc => acc.name === accountName && acc.nikke_area_id === areaId
		);

		if (!selectedAccount) {
			await interaction.reply({
				content: "❌ 找不到指定的帳號，請重新選擇",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		try {
			// 從 cookie 中提取 intl_open_id
			const cookieMatch =
				selectedAccount.cookie.match(/game_openid=([^;]+)/);
			if (!cookieMatch) {
				await interaction.reply({
					content: "❌ Cookie 中找不到 game_openid",
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			const intl_open_id = cookieMatch[1];
			if (!intl_open_id) {
				await interaction.reply({
					content: "❌ 無法從 Cookie 中提取有效的 game_openid",
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			const nikke_area_id = parseInt(areaId);
			const [basicInfo, outpostInfo, dailyProgress] = await Promise.all([
				getUserProfileBasicInfo(
					intl_open_id,
					nikke_area_id,
					selectedAccount.cookie
				),
				getUserProfileOutpostInfo(
					intl_open_id,
					nikke_area_id,
					selectedAccount.cookie
				),
				getUserDailyContentsProgress(
					intl_open_id,
					nikke_area_id,
					selectedAccount.cookie
				)
			]);

			// 檢查是否有任何請求失敗
			if (!basicInfo && !outpostInfo && !dailyProgress) {
				await interaction.reply({
					content: "❌ 無法獲取遊戲資料，請確認帳號 Cookie 是否有效",
					flags: MessageFlags.Ephemeral
				});
				return;
			}

			await interaction.deferReply();

			// 如果用戶選擇生成圖片
			try {
				// 創建個人資料數據
				const profileData = createProfileDataFromApi(
					basicInfo,
					outpostInfo,
					dailyProgress,
					accountName,
					nikke_area_id
				);

				const imageBuffer = await generateProfileImage(profileData);
				const attachment = new AttachmentBuilder(imageBuffer, {
					name: `${accountName}_profile.webp`
				});
				let currencyString = "";
				if (currencies) {
					const currencies = (basicInfo?.data?.basic_info).currencies;
					currencyString = `-# ${currencies
						.map((currency: any) => {
							const emojiKey =
								currency.type as keyof typeof emoji;
							const emojiIcon = emoji[emojiKey];
							if (!emojiIcon) return null;
							const formattedValue = formatNumber(
								parseInt(currency.value)
							);
							return `${emojiIcon}${formattedValue}`;
						})
						.filter(Boolean)
						.join(" ")}`;
				}
				await interaction.editReply({
					content: currencyString,
					files: [attachment]
				});
			} catch (imageError) {
				logger.error(`圖片生成失敗: ${(imageError as Error).message}`);

				await interaction.editReply({
					content: "⚠️ 圖片生成失敗"
				});
			}
		} catch (error) {
			logger.error(`Profile 指令執行失敗: ${(error as Error).message}`);

			await interaction.editReply({
				content: "❌ 獲取遊戲資料時發生錯誤，請稍後再試"
			});
		}
	}
};
