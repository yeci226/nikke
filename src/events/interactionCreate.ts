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
import {
	areaNameMap,
	elementNameMap,
	burstSkillNameMap,
	getUserCharacters
} from "../utils/nikke.js";
import charactersData from "../utils/characters-tw.json" with { type: "json" };
import type { Character } from "../types/index.js";

// 類型安全的 characters 數組
const characters: Character[] = charactersData as Character[];
const webhook = new WebhookClient({ url: process.env.CMDWEBHOOK! });

// Handle autocomplete interactions
async function handleAutocomplete(
	interaction: AutocompleteInteraction
): Promise<void> {
	try {
		const focusedValue = interaction.options.getFocused();
		const commandName = interaction.commandName;

		// 處理 team 指令的角色 autocomplete
		if (commandName === "team") {
			// 獲取已選擇的角色名稱
			const selectedCharacters = new Set<string>();
			interaction.options.data.forEach(option => {
				if (
					option.type === ApplicationCommandOptionType.String &&
					option.value
				) {
					selectedCharacters.add(option.value as string);
				}
			});

			const filtered = characters
				.filter(character => {
					const characterName =
						character.name_localkey.name.toLowerCase();
					const element =
						elementNameMap[
							character.element_id.element
								.element as keyof typeof elementNameMap
						]?.toLowerCase() ||
						character.element_id.element.element.toLowerCase();
					const burstSkill =
						burstSkillNameMap[
							character.use_burst_skill as keyof typeof burstSkillNameMap
						]?.toLowerCase() ||
						character.use_burst_skill.toLowerCase();
					const corporation = character.corporation.toLowerCase();
					const searchValue = focusedValue.toLowerCase();

					// 過濾掉已選擇的角色
					if (selectedCharacters.has(character.name_localkey.name)) {
						return false;
					}

					return (
						characterName.includes(searchValue) ||
						element.includes(searchValue) ||
						burstSkill.includes(searchValue) ||
						corporation.includes(searchValue)
					);
				})
				.slice(0, 25)
				.map(character => ({
					name: `${character.name_localkey.name} | ${elementNameMap[character.element_id.element.element as keyof typeof elementNameMap]} | ${burstSkillNameMap[character.use_burst_skill as keyof typeof burstSkillNameMap]} | ${character.corporation}`,
					value: character.name_localkey.name
				}));

			await interaction.respond(filtered);
			return;
		}

		// 處理 character 指令的角色 autocomplete
		if (commandName === "character") {
			const subcommand = interaction.options.getSubcommand();

			if (subcommand === "detail") {
				const focusedOption = interaction.options.getFocused(true);

				// 如果是角色選項的 autocomplete
				if (focusedOption.name === "character") {
					// 獲取帳號選項
					const accountValue =
						interaction.options.getString("account");
					if (!accountValue) {
						await interaction.respond([]);
						return;
					}

					const [accountName, areaId] = accountValue.split("|");
					if (!accountName || !areaId) {
						await interaction.respond([]);
						return;
					}

					// 獲取用戶帳號資料
					const accounts = await databaseService.getUserAccounts(
						interaction.user.id
					);
					const selectedAccount = accounts.find(
						acc =>
							acc.name === accountName &&
							acc.nikke_area_id === areaId
					);

					if (!selectedAccount) {
						await interaction.respond([]);
						return;
					}

					// 獲取玩家角色資料
					try {
						// 從 cookie 中提取 intl_open_id
						const cookieMatch =
							selectedAccount.cookie.match(/game_openid=([^;]+)/);
						if (!cookieMatch) {
							await interaction.respond([]);
							return;
						}

						const intl_open_id = cookieMatch[1];
						if (!intl_open_id) {
							await interaction.respond([]);
							return;
						}

						const nikke_area_id = parseInt(areaId);

						// 調用 API 獲取玩家角色
						const userCharactersResponse = await getUserCharacters(
							intl_open_id,
							nikke_area_id,
							selectedAccount.cookie
						);

						if (
							!userCharactersResponse ||
							!userCharactersResponse.data
						) {
							// 如果無法獲取玩家角色，回退到所有角色
							const filtered = characters
								.filter(character => {
									const characterName =
										character.name_localkey.name.toLowerCase();
									const element =
										elementNameMap[
											character.element_id.element
												.element as keyof typeof elementNameMap
										]?.toLowerCase() ||
										character.element_id.element.element.toLowerCase();
									const burstSkill =
										burstSkillNameMap[
											character.use_burst_skill as keyof typeof burstSkillNameMap
										]?.toLowerCase() ||
										character.use_burst_skill.toLowerCase();
									const corporation =
										character.corporation.toLowerCase();
									const searchValue =
										focusedValue.toLowerCase();

									return (
										characterName.includes(searchValue) ||
										element.includes(searchValue) ||
										burstSkill.includes(searchValue) ||
										corporation.includes(searchValue)
									);
								})
								.slice(0, 25)
								.map(character => ({
									name: `${character.name_localkey.name} | ${elementNameMap[character.element_id.element.element as keyof typeof elementNameMap]} | ${burstSkillNameMap[character.use_burst_skill as keyof typeof burstSkillNameMap]}`,
									value: character.name_localkey.name
								}));

							await interaction.respond(filtered);
							return;
						}

						// 處理玩家角色資料
						const characterList =
							userCharactersResponse.data.character_list ||
							userCharactersResponse.data.characters ||
							[];
						const userCharacters = characterList
							.map((char: any) => {
								// 根據 name_code 從 characters-tw.json 中找到對應的角色資料
								const characterData = characters.find(
									(c: any) => c.name_code === char.name_code
								);

								if (!characterData) {
									return null;
								}

								return {
									resource_id: characterData.resource_id,
									name_localkey: {
										name: characterData.name_localkey.name
									},
									original_rare: characterData.original_rare,
									class: characterData.class,
									element_id: characterData.element_id,
									shot_id: characterData.shot_id,
									use_burst_skill:
										characterData.use_burst_skill,
									corporation: characterData.corporation,
									// 玩家角色特有資料
									combat: char.combat || 0,
									costume_id: char.costume_id || 0,
									grade: char.grade || 0,
									lv: char.lv || 1,
									name_code: char.name_code
								};
							})
							.filter(Boolean); // 過濾掉 null 值

						// 按戰鬥力排序
						const sortedCharacters = userCharacters.sort(
							(a: any, b: any) =>
								(b.combat || 0) - (a.combat || 0)
						);

						const filtered = sortedCharacters
							.filter((character: any) => {
								const characterName =
									character.name_localkey.name.toLowerCase();
								const element =
									elementNameMap[
										character.element_id.element
											.element as keyof typeof elementNameMap
									]?.toLowerCase() ||
									character.element_id.element.element.toLowerCase();
								const burstSkill =
									burstSkillNameMap[
										character.use_burst_skill as keyof typeof burstSkillNameMap
									]?.toLowerCase() ||
									character.use_burst_skill.toLowerCase();
								const corporation =
									character.corporation.toLowerCase();
								const searchValue = focusedValue.toLowerCase();

								return (
									characterName.includes(searchValue) ||
									element.includes(searchValue) ||
									burstSkill.includes(searchValue) ||
									corporation.includes(searchValue)
								);
							})
							.slice(0, 25)
							.map((character: any) => {
								// 格式化顯示：角色名 | 戰鬥力 | 等級 | 突破 | 元素 | 爆裂技能
								const combat = character.combat
									? `戰鬥力 ${character.combat.toLocaleString()}`
									: "戰鬥力 0";
								const level = character.lv
									? `等級 ${character.lv}`
									: "等級 1";
								const grade = character.grade || 0;
								const core = character.core || 0;
								const breakthrough =
									core > 0
										? `突破 ${grade}+${core}`
										: `突破 ${grade}`;
								const element =
									elementNameMap[
										character.element_id.element
											.element as keyof typeof elementNameMap
									] || character.element_id.element.element;
								const burstSkill =
									burstSkillNameMap[
										character.use_burst_skill as keyof typeof burstSkillNameMap
									] || character.use_burst_skill;

								return {
									name: `${character.name_localkey.name} | ${combat} | ${level} | ${breakthrough} | ${element} | ${burstSkill}`,
									value: character.name_localkey.name
								};
							});

						await interaction.respond(filtered);
						return;
					} catch (error) {
						console.error("獲取玩家角色資料失敗:", error);
						// 發生錯誤時回退到所有角色
						const filtered = characters
							.filter(character => {
								const characterName =
									character.name_localkey.name.toLowerCase();
								const element =
									elementNameMap[
										character.element_id.element
											.element as keyof typeof elementNameMap
									]?.toLowerCase() ||
									character.element_id.element.element.toLowerCase();
								const burstSkill =
									burstSkillNameMap[
										character.use_burst_skill as keyof typeof burstSkillNameMap
									]?.toLowerCase() ||
									character.use_burst_skill.toLowerCase();
								const corporation =
									character.corporation.toLowerCase();
								const searchValue = focusedValue.toLowerCase();

								return (
									characterName.includes(searchValue) ||
									element.includes(searchValue) ||
									burstSkill.includes(searchValue) ||
									corporation.includes(searchValue)
								);
							})
							.slice(0, 25)
							.map(character => {
								// 回退時顯示基本格式（沒有玩家數據）
								const element =
									elementNameMap[
										character.element_id.element
											.element as keyof typeof elementNameMap
									] || character.element_id.element.element;
								const burstSkill =
									burstSkillNameMap[
										character.use_burst_skill as keyof typeof burstSkillNameMap
									] || character.use_burst_skill;

								return {
									name: `${character.name_localkey.name} | ${element} | ${burstSkill}`,
									value: character.name_localkey.name
								};
							});

						await interaction.respond(filtered);
						return;
					}
				}
			}
		}

		// 處理其他指令的帳號 autocomplete
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
