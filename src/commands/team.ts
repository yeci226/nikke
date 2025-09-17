import {
	SlashCommandBuilder,
	ChatInputCommandInteraction,
	AttachmentBuilder
} from "discord.js";
import { Logger } from "../services/logger.js";
import { getFontString, burstSkillNameMap } from "../utils/nikke.js";
import charactersData from "../utils/characters-tw.json" with { type: "json" };
import type { Character } from "../types/index.js";

// 類型安全的 characters 數組
const characters: Character[] = charactersData as Character[];
import { createCanvas, GlobalFonts, loadImage, Canvas } from "@napi-rs/canvas";
import path, { join } from "path";

// 字體註冊
GlobalFonts.registerFromPath(
	join(".", "src", ".", "assets", "YaHei.ttf"),
	"YaHei"
);
GlobalFonts.registerFromPath(
	join(".", "src", ".", "assets", "DINNextLTPro-Regular.woff2"),
	"DINNextLTPro"
);

const logger = new Logger();

// 配置常量
const CONFIG = {
	ASSETS_BASE_PATH: path.join("src", "assets", "images"),
	CARD: {
		PORTRAIT_SIZE: 300,
		WIDTH: 300,
		HEIGHT: 400,
		SPACING: 20,
		RARITY_BG_HEIGHT: Math.round((93 * 300) / 160) // 約174px
	},
	ICON: {
		SIZE_X: 63 * 0.9,
		SIZE_Y: 72 * 0.9,
		PADDING: 10,
		JOB_SIZE: 120
	},
	FONT: {
		LEVEL_SIZE: 36,
		NAME_SIZE: 40
	},
	COLORS: {
		BACKGROUND: "#1a1a1a",
		TEXT: "#ffffff",
		SHADOW: "rgba(0, 0, 0, 0.5)"
	},
	SHADOW: {
		BLUR: 10,
		OFFSET_X: 2,
		OFFSET_Y: 2
	},
	BURST_SEQUENCE: {
		HEIGHT: 60,
		ICON_SIZE: 40,
		PORTRAIT_SIZE: 50,
		SPACING: 12
	},
	NAME_DISPLAY: {
		MAX_WIDTH: 280, // 角色名稱最大顯示寬度（留出職業圖標空間）
		MIN_FONT_SIZE: 20, // 最小字體大小
		MAX_FONT_SIZE: 40 // 最大字體大小
	}
} as const;

// Character 接口已從 types/index.ts 導入

interface TeamConfig {
	characters: string[];
	canvas: Canvas;
	ctx: any; // @napi-rs/canvas context type
}

// 映射表
const ELEMENT_MAP: Record<string, string> = {
	Fire: "fire",
	Water: "water",
	Wind: "wind",
	Iron: "iron",
	Electronic: "electronic"
};

const WEAPON_MAP: Record<string, string> = {
	AR: "assault_rifle",
	MG: "machine_gun",
	SMG: "sub_machine_gun",
	SG: "shot_gun",
	SR: "sniper_rifle",
	RL: "rocket_launcher"
};

const RARITY_COLOR_MAP: Record<string, string> = {
	SSR: "yellow",
	SR: "purple",
	R: "blue"
};

// 圖片路徑獲取函數
const getCharacterPortraitPath = (resourceId: number): string =>
	path.join(
		CONFIG.ASSETS_BASE_PATH,
		`sprite/si_c${resourceId.toString().padStart(3, "0")}_00_s.png`
	);

const getElementIconPath = (element: string): string =>
	path.join(
		CONFIG.ASSETS_BASE_PATH,
		`icon-code-${ELEMENT_MAP[element] || element.toLowerCase()}.webp`
	);

const getWeaponIconPath = (weaponType: string): string =>
	path.join(
		CONFIG.ASSETS_BASE_PATH,
		`icon-weapon-${WEAPON_MAP[weaponType] || weaponType.toLowerCase()}.webp`
	);

const getBurstSkillIconPath = (burstSkill: string): string =>
	path.join(CONFIG.ASSETS_BASE_PATH, `${burstSkill.toLowerCase()}.webp`);

const getIconBgPath = (): string =>
	path.join(CONFIG.ASSETS_BASE_PATH, "icon-bg.webp");

const getRarityBgPath = (rarity: string): string =>
	path.join(CONFIG.ASSETS_BASE_PATH, `${rarity}.webp`);

const getJobIconPath = (classType: string, rarity: string): string => {
	const color = RARITY_COLOR_MAP[rarity] || "blue";
	return path.join(
		CONFIG.ASSETS_BASE_PATH,
		`nikke-job-${classType.toLowerCase()}--${color}.webp`
	);
};

// 獲取爆裂階段圖標路徑
const getBurstStepIconPath = (step: string): string => {
	return path.join(CONFIG.ASSETS_BASE_PATH, `${step.toLowerCase()}.webp`);
};

// 輔助函數
const findCharacterByName = (name: string): Character | undefined =>
	characters.find((char: Character) => char.name_localkey.name === name);

const validateTeamCharacters = (
	characterNames: string[]
): { valid: boolean; missing?: string[] } => {
	const uniqueNames = new Set(characterNames);

	if (uniqueNames.size !== characterNames.length) {
		return { valid: false, missing: ["重複的角色"] };
	}

	const missingCharacters = characterNames.filter(
		name => !findCharacterByName(name)
	);
	return missingCharacters.length > 0
		? { valid: false, missing: missingCharacters }
		: { valid: true };
};

const setupCanvas = (
	totalWidth: number,
	totalHeight: number
): { canvas: Canvas; ctx: any } => {
	const canvas = createCanvas(totalWidth, totalHeight);
	const ctx = canvas.getContext("2d");

	// 填充背景
	ctx.fillStyle = CONFIG.COLORS.BACKGROUND;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	return { canvas, ctx };
};

const applyTextShadow = (ctx: any): void => {
	ctx.shadowColor = CONFIG.COLORS.SHADOW;
	ctx.shadowBlur = CONFIG.SHADOW.BLUR;
	ctx.shadowOffsetX = CONFIG.SHADOW.OFFSET_X;
	ctx.shadowOffsetY = CONFIG.SHADOW.OFFSET_Y;
};

const clearTextShadow = (ctx: any): void => {
	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 0;
};

// 爆裂階段項目類型
interface BurstSequenceItem {
	step: string;
	stepIcon: any; // 加載後的圖片對象
	characters: Character[]; // 該階段的所有角色
	portraits: any[]; // 加載後的角色頭像數組
}

// 獲取爆裂技能順序的函數
const getBurstSequence = (characters: Character[]): BurstSequenceItem[] => {
	// 按爆裂階段分組角色
	const stepGroups: Record<string, Character[]> = {
		step1: [],
		step2: [],
		step3: []
	};

	// 將角色分配到對應的階段組
	for (const char of characters) {
		const burstSkill = char.use_burst_skill;

		if (burstSkill === "AllStep") {
			// 全爆裂角色分配到所有階段
			stepGroups.step1!.push(char);
			stepGroups.step2!.push(char);
			stepGroups.step3!.push(char);
		} else {
			// 單階段角色分配到對應階段
			const stepKey = burstSkill.toLowerCase();
			if (stepGroups[stepKey as keyof typeof stepGroups]) {
				stepGroups[stepKey as keyof typeof stepGroups]!.push(char);
			}
		}
	}

	// 生成最終序列（只包含有角色的階段）
	const sequence: BurstSequenceItem[] = [];
	const stepOrder = ["step1", "step2", "step3"];

	for (const step of stepOrder) {
		const stepGroup = stepGroups[step as keyof typeof stepGroups];
		if (stepGroup && stepGroup.length > 0) {
			sequence.push({
				step: step,
				stepIcon: getBurstStepIconPath(step),
				characters: stepGroup,
				portraits: [] // 將在後面預加載
			});
		}
	}

	return sequence;
};

// 計算適合角色名稱的字體大小和處理文字截斷
const calculateNameFontSize = (
	ctx: any,
	name: string,
	maxWidth: number
): { fontSize: number; displayName: string } => {
	let fontSize = CONFIG.NAME_DISPLAY.MAX_FONT_SIZE;
	let displayName = name;

	// 首先檢查是否需要截斷文字
	ctx.font = getFontString(CONFIG.NAME_DISPLAY.MIN_FONT_SIZE, "normal", name);
	const minSizeMetrics = ctx.measureText(name);

	// 如果最小字體都超出寬度，則截斷文字
	if (minSizeMetrics.width > maxWidth) {
		displayName = truncateText(
			ctx,
			name,
			maxWidth,
			CONFIG.NAME_DISPLAY.MIN_FONT_SIZE
		);
	}

	// 從最大字體開始，逐步縮小直到文字適合寬度
	while (fontSize >= CONFIG.NAME_DISPLAY.MIN_FONT_SIZE) {
		ctx.font = getFontString(fontSize, "normal", displayName);
		const textMetrics = ctx.measureText(displayName);

		if (textMetrics.width <= maxWidth) {
			break;
		}

		fontSize -= 2; // 每次減少2px
	}

	return {
		fontSize: Math.max(fontSize, CONFIG.NAME_DISPLAY.MIN_FONT_SIZE),
		displayName
	};
};

// 截斷文字的輔助函數
const truncateText = (
	ctx: any,
	text: string,
	maxWidth: number,
	fontSize: number
): string => {
	const ellipsis = "...";
	ctx.font = getFontString(fontSize, "normal", text);

	let truncatedText = text;
	let ellipsisWidth = ctx.measureText(ellipsis).width;

	while (truncatedText.length > 0) {
		const textWidth = ctx.measureText(truncatedText).width;

		if (textWidth + ellipsisWidth <= maxWidth) {
			return truncatedText + ellipsis;
		}

		truncatedText = truncatedText.slice(0, -1);
	}

	return ellipsis;
};

// 預加載爆裂順序圖片
const preloadBurstSequenceImages = async (
	sequence: BurstSequenceItem[]
): Promise<BurstSequenceItem[]> => {
	const loadedSequence: BurstSequenceItem[] = [];

	for (const item of sequence) {
		try {
			// 加載爆裂階段圖標
			const stepIcon = await loadImage(item.stepIcon);

			// 加載該階段所有角色的頭像
			const portraits: any[] = [];
			for (const character of item.characters) {
				try {
					const portraitPath = getCharacterPortraitPath(
						character.resource_id
					);
					const portrait = await loadImage(portraitPath);
					portraits.push(portrait);
				} catch (error) {
					logger.warn(
						`無法加載角色頭像: ${character.name_localkey.name}`
					);
				}
			}

			loadedSequence.push({
				step: item.step,
				stepIcon: stepIcon,
				characters: item.characters,
				portraits: portraits
			});
		} catch (error) {
			logger.warn(`無法加載爆裂階段圖標: ${item.stepIcon}`);
		}
	}

	return loadedSequence;
};

// 繪製爆裂技能順序的函數
const drawBurstSequence = (
	ctx: any,
	sequence: BurstSequenceItem[],
	canvasWidth: number,
	canvasHeight: number
): void => {
	const startY = canvasHeight - CONFIG.BURST_SEQUENCE.HEIGHT;

	// 計算總寬度（階段圖標 + 所有角色頭像 + 間距）
	let totalWidth = 0;
	for (const item of sequence) {
		totalWidth += CONFIG.BURST_SEQUENCE.ICON_SIZE; // 階段圖標寬度
		totalWidth += CONFIG.BURST_SEQUENCE.SPACING; // 圖標與頭像間距
		totalWidth +=
			item.portraits.length * CONFIG.BURST_SEQUENCE.PORTRAIT_SIZE; // 所有頭像寬度
		totalWidth +=
			(item.portraits.length - 1) * CONFIG.BURST_SEQUENCE.SPACING; // 頭像間距
		totalWidth += CONFIG.BURST_SEQUENCE.SPACING; // 階段間距
	}
	totalWidth -= CONFIG.BURST_SEQUENCE.SPACING; // 減去最後一個多餘的間距

	const startX = (canvasWidth - totalWidth) / 2;
	let currentX = startX;

	// 繪製每個爆裂階段項目
	for (const item of sequence) {
		if (!item) continue; // 確保 item 存在

		// 繪製爆裂階段圖標
		if (item.stepIcon) {
			ctx.drawImage(
				item.stepIcon,
				currentX,
				startY +
					(CONFIG.BURST_SEQUENCE.HEIGHT -
						CONFIG.BURST_SEQUENCE.ICON_SIZE) /
						2,
				CONFIG.BURST_SEQUENCE.ICON_SIZE,
				CONFIG.BURST_SEQUENCE.ICON_SIZE
			);
		}

		currentX +=
			CONFIG.BURST_SEQUENCE.ICON_SIZE + CONFIG.BURST_SEQUENCE.SPACING;

		// 繪製該階段所有角色的頭像
		for (let i = 0; i < item.portraits.length; i++) {
			const portrait = item.portraits[i];
			if (portrait) {
				ctx.drawImage(
					portrait,
					currentX,
					startY +
						(CONFIG.BURST_SEQUENCE.HEIGHT -
							CONFIG.BURST_SEQUENCE.PORTRAIT_SIZE) /
							2,
					CONFIG.BURST_SEQUENCE.PORTRAIT_SIZE,
					CONFIG.BURST_SEQUENCE.PORTRAIT_SIZE
				);
			}

			currentX +=
				CONFIG.BURST_SEQUENCE.PORTRAIT_SIZE +
				CONFIG.BURST_SEQUENCE.SPACING;
		}
	}
};

// 繪製角色卡片的函數
const drawCharacterCard = async (
	ctx: any,
	char: Character,
	offsetX: number,
	charImages: Map<string, any>,
	sharedImages: Map<string, any>
): Promise<void> => {
	const bottomY = CONFIG.CARD.HEIGHT - CONFIG.CARD.RARITY_BG_HEIGHT;

	// 1. 繪製角色頭像
	const portrait = charImages.get("portrait");
	if (portrait) {
		const portraitX =
			offsetX + (CONFIG.CARD.WIDTH - CONFIG.CARD.PORTRAIT_SIZE) / 2;
		ctx.drawImage(
			portrait,
			portraitX,
			0,
			CONFIG.CARD.PORTRAIT_SIZE,
			CONFIG.CARD.PORTRAIT_SIZE
		);
	}

	// 2. 繪製底部資訊欄（使用稀有度背景）
	const rarityBg = charImages.get("rarityBg");
	if (rarityBg) {
		ctx.drawImage(
			rarityBg,
			offsetX,
			bottomY,
			CONFIG.CARD.WIDTH,
			CONFIG.CARD.RARITY_BG_HEIGHT
		);
	}

	// 3. 繪製職業圖標背景
	const jobIcon = charImages.get("jobIcon");
	if (jobIcon) {
		const jobIconX = offsetX + CONFIG.CARD.WIDTH - CONFIG.ICON.JOB_SIZE;
		const jobIconY =
			bottomY +
			(CONFIG.CARD.RARITY_BG_HEIGHT - CONFIG.ICON.JOB_SIZE) / 2 -
			20;
		ctx.drawImage(
			jobIcon,
			jobIconX,
			jobIconY,
			CONFIG.ICON.JOB_SIZE,
			CONFIG.ICON.JOB_SIZE
		);
	}

	// 4. 繪製角色名稱
	applyTextShadow(ctx);

	// 計算適合的字體大小和顯示名稱
	const nameInfo = calculateNameFontSize(
		ctx,
		char.name_localkey.name,
		CONFIG.NAME_DISPLAY.MAX_WIDTH
	);
	ctx.font = getFontString(nameInfo.fontSize, "normal", nameInfo.displayName);
	ctx.fillStyle = CONFIG.COLORS.TEXT;
	ctx.textAlign = "right";
	ctx.fillText(
		nameInfo.displayName,
		offsetX + CONFIG.CARD.WIDTH - 10,
		bottomY + CONFIG.CARD.RARITY_BG_HEIGHT / 2 + nameInfo.fontSize / 2 + 10
	);
	clearTextShadow(ctx);

	// 5. 繪製左上角圖標
	let currentIconY = 20;

	// 元素圖標
	const elementIcon = charImages.get("elementIcon");
	if (elementIcon) {
		ctx.drawImage(
			elementIcon,
			offsetX + CONFIG.ICON.PADDING,
			currentIconY,
			CONFIG.ICON.SIZE_X,
			CONFIG.ICON.SIZE_Y
		);
	}

	currentIconY += CONFIG.ICON.SIZE_Y + CONFIG.ICON.PADDING;

	// 武器圖標
	const iconBg = sharedImages.get("iconBg");
	const weaponIcon = charImages.get("weaponIcon");
	if (iconBg && weaponIcon) {
		ctx.drawImage(
			iconBg,
			offsetX + CONFIG.ICON.PADDING,
			currentIconY,
			CONFIG.ICON.SIZE_X,
			CONFIG.ICON.SIZE_Y
		);
		ctx.drawImage(
			weaponIcon,
			offsetX + CONFIG.ICON.PADDING + CONFIG.ICON.SIZE_X * 0.1,
			currentIconY + CONFIG.ICON.SIZE_Y * 0.1,
			CONFIG.ICON.SIZE_X * 0.8,
			CONFIG.ICON.SIZE_Y * 0.8
		);
	}

	currentIconY += CONFIG.ICON.SIZE_Y + CONFIG.ICON.PADDING;

	// 爆裂技能圖標
	const burstSkillIcon = charImages.get("burstSkillIcon");
	if (iconBg && burstSkillIcon) {
		ctx.drawImage(
			iconBg,
			offsetX + CONFIG.ICON.PADDING,
			currentIconY,
			CONFIG.ICON.SIZE_X,
			CONFIG.ICON.SIZE_Y
		);
		ctx.drawImage(
			burstSkillIcon,
			offsetX + CONFIG.ICON.PADDING + CONFIG.ICON.SIZE_X * 0.1,
			currentIconY + CONFIG.ICON.SIZE_Y * 0.1,
			CONFIG.ICON.SIZE_X * 0.8,
			CONFIG.ICON.SIZE_Y * 0.8
		);
	}
};

// 創建角色選項的輔助函數
const getOrdinalNumber = (index: number): string => {
	const ordinals = ["", "first", "second", "third", "fourth", "fifth"];
	return ordinals[index] || "unknown";
};

const getChineseOrdinal = (index: number): string => {
	const ordinals = ["", "一", "二", "三", "四", "五"];
	return ordinals[index] || "未知";
};

export default {
	data: new SlashCommandBuilder()
		.setName("team")
		.setDescription("Create a team composition with 5 Nikke characters")
		.setNameLocalizations({
			"zh-TW": "隊伍"
		})
		.setDescriptionLocalizations({
			"zh-TW": "建立包含 5 位妮姬角色的隊伍配置"
		})
		.addStringOption(option =>
			option
				.setName("character1")
				.setDescription(`Select the ${getOrdinalNumber(1)} character`)
				.setNameLocalizations({
					"zh-TW": "角色1"
				})
				.setDescriptionLocalizations({
					"zh-TW": `選擇第${getChineseOrdinal(1)}位角色`
				})
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addStringOption(option =>
			option
				.setName("character2")
				.setDescription(`Select the ${getOrdinalNumber(2)} character`)
				.setNameLocalizations({
					"zh-TW": "角色2"
				})
				.setDescriptionLocalizations({
					"zh-TW": `選擇第${getChineseOrdinal(2)}位角色`
				})
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addStringOption(option =>
			option
				.setName("character3")
				.setDescription(`Select the ${getOrdinalNumber(3)} character`)
				.setNameLocalizations({
					"zh-TW": "角色3"
				})
				.setDescriptionLocalizations({
					"zh-TW": `選擇第${getChineseOrdinal(3)}位角色`
				})
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addStringOption(option =>
			option
				.setName("character4")
				.setDescription(`Select the ${getOrdinalNumber(4)} character`)
				.setNameLocalizations({
					"zh-TW": "角色4"
				})
				.setDescriptionLocalizations({
					"zh-TW": `選擇第${getChineseOrdinal(4)}位角色`
				})
				.setRequired(true)
				.setAutocomplete(true)
		)
		.addStringOption(option =>
			option
				.setName("character5")
				.setDescription(`Select the ${getOrdinalNumber(5)} character`)
				.setNameLocalizations({
					"zh-TW": "角色5"
				})
				.setDescriptionLocalizations({
					"zh-TW": `選擇第${getChineseOrdinal(5)}位角色`
				})
				.setRequired(true)
				.setAutocomplete(true)
		),

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		await interaction.deferReply();

		try {
			// 獲取所有角色選項
			const selectedCharacters = Array.from({ length: 5 }, (_, i) =>
				interaction.options.getString(`character${i + 1}`, true)
			);

			// 驗證角色選擇
			const validation = validateTeamCharacters(selectedCharacters);
			if (!validation.valid) {
				const errorMessage = validation.missing?.includes("重複的角色")
					? "❌ 隊伍中不能有重複的角色，請重新選擇"
					: `❌ 找不到以下角色：${validation.missing?.join(", ")}，請重新選擇`;

				await interaction.editReply({ content: errorMessage });
				return;
			}

			// 獲取角色詳細信息
			const teamCharacters = selectedCharacters
				.map(findCharacterByName)
				.filter((char): char is Character => char !== undefined);

			// 生成隊伍圖片
			const totalWidth =
				CONFIG.CARD.WIDTH * teamCharacters.length +
				CONFIG.CARD.SPACING * (teamCharacters.length - 1);
			// 增加高度為爆裂技能順序留出空間
			const totalHeight =
				CONFIG.CARD.HEIGHT + CONFIG.BURST_SEQUENCE.HEIGHT;
			const { canvas, ctx } = setupCanvas(totalWidth, totalHeight);

			// 預加載所有需要的圖片
			const imageCache = new Map<string, any>();

			const sharedImages = [{ key: "iconBg", path: getIconBgPath() }];

			for (const image of sharedImages) {
				try {
					imageCache.set(image.key, await loadImage(image.path));
				} catch (error) {
					logger.warn(`無法加載共享圖片: ${image.path}`);
				}
			}

			// 為每個角色預加載專屬圖片
			const characterImages = new Map<number, Map<string, any>>();

			for (const char of teamCharacters) {
				const charImageMap = new Map<string, any>();
				const images = [
					{
						key: "portrait",
						path: getCharacterPortraitPath(char.resource_id)
					},
					{
						key: "rarityBg",
						path: getRarityBgPath(char.original_rare)
					},
					{
						key: "jobIcon",
						path: getJobIconPath(char.class, char.original_rare)
					},
					{
						key: "elementIcon",
						path: getElementIconPath(
							char.element_id.element.element
						)
					},
					{
						key: "weaponIcon",
						path: getWeaponIconPath(
							char.shot_id.element.weapon_type
						)
					},
					{
						key: "burstSkillIcon",
						path: getBurstSkillIconPath(char.use_burst_skill)
					}
				];

				for (const image of images) {
					try {
						charImageMap.set(
							image.key,
							await loadImage(image.path)
						);
					} catch (error) {
						logger.warn(`無法加載角色圖片: ${image.path}`);
					}
				}

				characterImages.set(char.resource_id, charImageMap);
			}

			// 繪製每個角色卡片
			for (let i = 0; i < teamCharacters.length; i++) {
				const char = teamCharacters[i];
				if (!char) continue; // 確保 char 不是 undefined

				const offsetX = i * (CONFIG.CARD.WIDTH + CONFIG.CARD.SPACING);
				const charImages = characterImages.get(char.resource_id);

				if (charImages) {
					await drawCharacterCard(
						ctx,
						char,
						offsetX,
						charImages,
						imageCache
					);
				}
			}

			// 處理爆裂技能順序
			const burstSequence = getBurstSequence(teamCharacters);
			const loadedBurstSequence =
				await preloadBurstSequenceImages(burstSequence);
			drawBurstSequence(
				ctx,
				loadedBurstSequence,
				totalWidth,
				totalHeight
			);

			// 將 canvas 轉換為 buffer
			const buffer = canvas.toBuffer("image/png");
			const attachment = new AttachmentBuilder(buffer, {
				name: "team_composition.png"
			});

			await interaction.editReply({
				files: [attachment]
			});
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "未知錯誤";
			logger.error(`Team 指令執行失敗: ${errorMessage}`, { error });

			// 提供更具體的錯誤信息
			let userMessage = "❌ 建立隊伍時發生錯誤，請稍後再試";
			if (errorMessage.includes("ENOENT")) {
				userMessage = "❌ 找不到角色圖片文件，請聯繫管理員";
			} else if (errorMessage.includes("Invalid image")) {
				userMessage = "❌ 圖片格式錯誤，請重新選擇角色";
			}

			await interaction.editReply({ content: userMessage });
		}
	}
};
