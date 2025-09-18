import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { join } from "path";
import { readdir } from "fs/promises";
import { areaNameMap, getFontString } from "./nikke.js";
import chapterData from "./chapter.json" with { type: "json" };
import charactersDataRaw from "./characters-tw.json" with { type: "json" };
import type { Character } from "../types/index.js";

// 類型安全的 characters 數組
const charactersData: Character[] = charactersDataRaw as Character[];
// 獲取當前文件的路徑

// 註冊字體
GlobalFonts.registerFromPath(
	join(".", "src", ".", "assets", "YaHei.ttf"),
	"YaHei"
);
GlobalFonts.registerFromPath(
	join(".", "src", ".", "assets", "DINNextLTPro-Regular.woff2"),
	"DINNextLTPro"
);

/**
 * 隨機選擇 gallery 資料夾中的一張圖片
 * @returns 隨機選擇的圖片路徑
 */
async function getRandomGalleryImage(): Promise<string> {
	try {
		const galleryPath = join(
			".",
			"src",
			".",
			"assets",
			".",
			"images",
			"background",
			"gallery"
		);

		// 讀取所有子資料夾
		const folders = await readdir(galleryPath, { withFileTypes: true });
		const imageFolders = folders
			.filter(dirent => dirent.isDirectory())
			.map(dirent => dirent.name);

		if (imageFolders.length === 0) {
			// 如果沒有子資料夾，回退到預設圖片
			return join(
				".",
				"src",
				".",
				"assets",
				".",
				"images",
				"topic-default.png"
			);
		}

		// 隨機選擇一個資料夾
		const randomIndex = Math.floor(Math.random() * imageFolders.length);
		const randomFolder = imageFolders[randomIndex];
		if (!randomFolder) {
			return join(
				".",
				"src",
				".",
				"assets",
				".",
				"images",
				"topic-default.png"
			);
		}
		const folderPath = join(galleryPath, randomFolder);

		// 讀取該資料夾中的所有圖片文件
		const files = await readdir(folderPath);
		const imageFiles = files.filter(
			file =>
				file.toLowerCase().endsWith(".png") ||
				file.toLowerCase().endsWith(".jpg") ||
				file.toLowerCase().endsWith(".jpeg") ||
				file.toLowerCase().endsWith(".webp")
		);

		if (imageFiles.length === 0) {
			// 如果該資料夾沒有圖片，回退到預設圖片
			return join(
				".",
				"src",
				".",
				"assets",
				".",
				"images",
				"topic-default.png"
			);
		}

		// 隨機選擇一張圖片
		const randomImageIndex = Math.floor(Math.random() * imageFiles.length);
		const randomImage = imageFiles[randomImageIndex];
		if (!randomImage) {
			return join(
				".",
				"src",
				".",
				"assets",
				".",
				"images",
				"topic-default.png"
			);
		}
		return join(folderPath, randomImage);
	} catch (error) {
		console.error("獲取隨機 gallery 圖片時發生錯誤:", error);
		// 發生錯誤時回退到預設圖片
		return join(
			".",
			"src",
			".",
			"assets",
			".",
			"images",
			"topic-default.png"
		);
	}
}

/**
 * 根據 icon_id 獲取角色圖片路徑
 * @param iconId - 玩家的 icon_id (例如: 52000 或 515100)
 * @returns 角色圖片路徑
 */
function getCharacterImagePath(iconId: number): string {
	// 將 icon_id 轉為字符串
	const iconStr = iconId.toString();

	// 確保至少有5位數
	if (iconStr.length < 5) {
		return join(
			".",
			"src",
			".",
			"assets",
			".",
			"images",
			"default-avatar.png"
		);
	}

	let nameCode: number;

	if (iconStr.length === 6) {
		// 6位數：直接使用前4位作為 name_code
		nameCode = parseInt(iconStr.substring(0, 4));
	} else {
		// 5位數：使用原本的方法
		// 分成兩部分：前3位和後2位
		const firstPart = iconStr.substring(0, 3); // "520"
		const secondPart = iconStr.substring(3, 5); // "00"

		// 取第二部分的第一個字符
		const firstChar = secondPart.charAt(0); // "0"

		// 將第一個字符插入第一部分的中間
		nameCode = parseInt(
			firstPart.charAt(0) + firstChar + firstPart.substring(1)
		); // "5020"
	}

	// 在 characters-tw.json 中查找對應的 resource_id
	const character = charactersData.find(
		(char: any) => char.name_code === nameCode
	);

	if (!character) {
		console.warn(
			`找不到 name_code: ${nameCode} 的角色 (icon_id: ${iconId})`
		);
		return join(
			".",
			"src",
			".",
			"assets",
			".",
			"images",
			"default-avatar.png"
		);
	}

	const resourceId = character.resource_id.toString().padStart(3, "0");
	const imagePath = `si_c${resourceId}_00_s.png`;

	return join(
		".",
		"src",
		".",
		"assets",
		".",
		"images",
		".",
		"sprite",
		imagePath
	);
}

interface ProfileData {
	// 基本資料
	playerName: string;
	playerLevel: number;
	playerId: string;
	areaId: number;
	iconId: number;

	// 遊戲進度
	towerFloor: number;
	normalProgress: string;
	hardProgress: string;
	teamCombat: number;
	syncLevel: number;
	costume: number;
	overclockMode: number;
	registrationDate: string;
	lastActionDate: string;
	characterCount: number;

	// 每日任務進度
	outpostDefense: number;
	intercept: number;
	rookieArena: number;
	specialArena: number;
	consultations: number;
	dispatchInProgress: number;
	dispatchCompleted: number;
	tribeTower: string;
	simulationRoom: string;
	biWeeklyReward: number;
	seasonHighRecord: number;
	dailyMissionReceivedPoints: number;
	dailyMissionReceivablePoints: number;

	// 前哨資訊
	generalResearch: number;
	attackerType: number;
	defenderType: number;
	supportType: number;
	missilis: number;
	elysion: number;
	tetra: number;
	pilgrim: number;
	abnormal: number;
}

/**
 * 預載入所有需要的圖片資源
 */
async function preloadImages(data: ProfileData): Promise<{
	backgroundImages: any[];
	uiImages: any[];
	characterImage: any;
}> {
	// 並行載入所有圖片
	const [
		// 背景圖片
		randomImagePath,
		// UI 圖片
		bgContentImage,
		bgTitleImage,
		bgUserInfoImage,
		outpostDefenseIcon,
		milestoneImage,
		pointImage,
		// 角色頭像
		characterImagePath
	] = await Promise.all([
		// 獲取隨機背景圖片路徑
		getRandomGalleryImage(),
		// 載入 UI 圖片
		loadImage(
			join(".", "src", ".", "assets", ".", "images", "bg-content.png")
		),
		loadImage(
			join(".", "src", ".", "assets", ".", "images", "bg-title.png")
		),
		loadImage(
			join(".", "src", ".", "assets", ".", "images", "bg-user-info.png")
		),
		loadImage(
			join(
				".",
				"src",
				".",
				"assets",
				".",
				"images",
				"userinfo-icon-outpost-defense.webp"
			)
		),
		loadImage(
			join(
				".",
				"src",
				".",
				"assets",
				".",
				"images",
				"userinfo-icon-crate.webp"
			)
		),
		loadImage(
			join(
				".",
				"src",
				".",
				"assets",
				".",
				"images",
				"userinfo-misson-point.webp"
			)
		),
		// 獲取角色頭像路徑
		Promise.resolve(getCharacterImagePath(data.iconId))
	]);

	// 並行載入背景圖片和角色頭像
	const [backgroundImage, characterImage] = await Promise.all([
		loadImage(randomImagePath),
		loadImage(characterImagePath).catch(() => null) // 如果載入失敗返回 null
	]);

	return {
		backgroundImages: [backgroundImage],
		uiImages: [
			bgContentImage,
			bgTitleImage,
			bgUserInfoImage,
			outpostDefenseIcon,
			milestoneImage,
			pointImage
		],
		characterImage: characterImage
	};
}

/**
 * 生成個人資料圖片
 */
export async function generateProfileImage(data: ProfileData): Promise<Buffer> {
	const canvas = createCanvas(1600, 2400);
	const ctx = canvas.getContext("2d");

	// 設置背景
	ctx.fillStyle = "#f5f5f5";
	ctx.fillRect(0, 0, 1600, 2400);
	let y = 60;

	// 預載入所有圖片資源
	const images = await preloadImages(data);

	// 按順序執行繪圖操作（因為需要正確的 y 坐標）
	y = await drawHeaderSection(ctx, canvas.width, y, data, images);
	y = await drawBasicInfoSection(ctx, canvas.width, y, data, images);
	y = await drawDailyMissionsSection(ctx, y, data, images);
	y = await drawOutpostInfoSection(ctx, y, data, images);

	return canvas.toBuffer("image/webp");
}

/**
 * 繪製頂部頭像區域
 */
async function drawHeaderSection(
	ctx: any,
	canvasWidth: number,
	y: number,
	data: ProfileData,
	images: { backgroundImages: any[]; uiImages: any[]; characterImage: any }
): Promise<number> {
	const x = 100;
	const avatarSize = 280;
	const headerHeight = 440;

	// 使用預載入的背景圖片
	const backgroundImage = images.backgroundImages[0];

	const imageAspectRatio = backgroundImage.width / backgroundImage.height;
	const targetAspectRatio = canvasWidth / headerHeight;

	let drawWidth, drawHeight, drawX, drawY;

	// 圖片往下移動的偏移量（像素）
	const imageOffsetY = 150;

	if (imageAspectRatio > targetAspectRatio) {
		// 圖片較寬，以高度為基準放大
		drawHeight = headerHeight;
		drawWidth = drawHeight * imageAspectRatio;
		drawX = (canvasWidth - drawWidth) / 2; // 水平居中
		drawY = y + (headerHeight - drawHeight) / 2 + imageOffsetY;
	} else {
		// 圖片較高，以寬度為基準放大
		drawWidth = canvasWidth;
		drawHeight = drawWidth / imageAspectRatio;
		drawX = 0;
		drawY = y + (headerHeight - drawHeight) / 2 + imageOffsetY; // 垂直居中並往下偏移
	}

	ctx.drawImage(backgroundImage, drawX, drawY, drawWidth, drawHeight);

	// 添加黑色遮罩
	ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
	ctx.fillRect(0, 0, canvasWidth, y + headerHeight + 100);

	// 頭像容器
	const avatarX = x + 80;
	const avatarY = y + 40;

	// 陰影效果
	ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
	ctx.shadowBlur = 30;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 10;

	// 頭像背景圓圈
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.arc(
		avatarX + avatarSize / 2,
		avatarY + avatarSize / 2,
		avatarSize / 2 + 16,
		0,
		Math.PI * 2
	);
	ctx.fill();

	// 重置陰影
	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 0;

	// 頭像邊框
	const borderGradient = ctx.createLinearGradient(
		0,
		0,
		avatarSize,
		avatarSize
	);
	borderGradient.addColorStop(0, "#ff6b6b");
	borderGradient.addColorStop(0.5, "#4ecdc4");
	borderGradient.addColorStop(1, "#45b7d1");
	ctx.strokeStyle = borderGradient;
	ctx.lineWidth = 12;
	ctx.beginPath();
	ctx.arc(
		avatarX + avatarSize / 2,
		avatarY + avatarSize / 2,
		avatarSize / 2 + 8,
		0,
		Math.PI * 2
	);
	ctx.stroke();

	// 繪製角色頭像
	if (images.characterImage) {
		// 創建圓形裁剪路徑
		ctx.save();
		ctx.beginPath();
		ctx.arc(
			avatarX + avatarSize / 2,
			avatarY + avatarSize / 2,
			avatarSize / 2 - 4,
			0,
			Math.PI * 2
		);
		ctx.clip();

		// 繪製角色圖片
		ctx.drawImage(
			images.characterImage,
			avatarX + 4,
			avatarY + 4,
			avatarSize - 8,
			avatarSize - 8
		);

		ctx.restore();
	} else {
		// 如果載入失敗，繪製預設頭像
		ctx.fillStyle = "#cccccc";
		ctx.font = getFontString(96, "bold", "?");
		ctx.textAlign = "center";
		ctx.fillText(
			"?",
			avatarX + avatarSize / 2,
			avatarY + avatarSize / 2 + 30
		);
	}

	// 玩家資訊區域
	const infoX = avatarX + avatarSize + 60;
	const infoY = y + 60;

	// 玩家名稱 - 帶陰影效果
	ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
	ctx.shadowBlur = 6;
	ctx.shadowOffsetX = 2;
	ctx.shadowOffsetY = 2;
	ctx.fillStyle = "#ffffff";
	ctx.font = getFontString(80, "bold", data.playerName);
	ctx.textAlign = "left";
	ctx.fillText(data.playerName, infoX, infoY + 120);

	// 計算玩家名稱的寬度
	const playerNameWidth = ctx.measureText(data.playerName).width;

	// 等級標籤 - 根據玩家名稱寬度定位
	const levelWidth = 200;
	const levelHeight = 70;
	const levelX = infoX + playerNameWidth + 30;
	const levelY = infoY + 60;

	// 等級背景 - 圓角漸變效果
	const levelGradient = ctx.createLinearGradient(
		levelX,
		levelY,
		levelX + levelWidth,
		levelY + levelHeight
	);
	levelGradient.addColorStop(0, "#38acfe");
	levelGradient.addColorStop(1, "#1190f5");
	ctx.fillStyle = levelGradient;

	// 繪製圓角矩形
	const radius = levelHeight / 2; // 圓角半徑為高度的一半
	ctx.beginPath();
	ctx.roundRect(levelX, levelY, levelWidth, levelHeight, radius);
	ctx.fill();

	// 等級文字
	ctx.shadowColor = "transparent";
	ctx.fillStyle = "#ffffff";
	ctx.font = getFontString(44, "bold", `Lv.${data.playerLevel}`);
	ctx.textAlign = "center";
	ctx.fillText(
		`Lv.${data.playerLevel}`,
		levelX + levelWidth / 2,
		levelY + 50
	);

	// 用戶ID和區域資訊
	ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
	ctx.font = getFontString(
		32,
		"normal",
		`${areaNameMap[data.areaId as keyof typeof areaNameMap]} • UID: ${data.playerId}`
	);
	ctx.textAlign = "left";
	ctx.fillText(
		`${areaNameMap[data.areaId as keyof typeof areaNameMap]} • UID: ${data.playerId}`,
		infoX,
		infoY + 180
	);

	// 重置陰影
	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 0;

	// 返回更新後的 y 坐標
	return y + headerHeight + 40;
}

/**
 * 繪製基本資訊區域
 */
async function drawBasicInfoSection(
	ctx: any,
	canvasWidth: number,
	y: number,
	data: ProfileData,
	images: { backgroundImages: any[]; uiImages: any[]; characterImage: any }
): Promise<number> {
	const x = 100;
	const sectionWidth = 1400;
	const sectionHeight = 500;

	// 背景
	const bg_contentImage = images.uiImages[0];
	ctx.drawImage(
		bg_contentImage,
		0,
		y - 100,
		canvasWidth,
		bg_contentImage.height * 2
	);

	// 標題背景
	ctx.drawImage(
		images.uiImages[1],
		x + sectionWidth / 2 - sectionWidth / 4,
		y - 24,
		sectionWidth / 2,
		88
	);

	// 標題
	ctx.fillStyle = "#4a90e2";
	ctx.font = getFontString(52, "bold", "基本資訊");
	ctx.textAlign = "center";
	ctx.fillText("基本資訊", x + sectionWidth / 2, y + 40);

	// 背景面板
	ctx.drawImage(images.uiImages[2], x, y + 80, sectionWidth, 576);

	// 網格布局
	const gridCols = 3;
	const gridRows = 3;
	const cellWidth = sectionWidth / gridCols;
	const cellHeight = sectionHeight / gridRows;

	// 基本資料項目
	const basicItems = [
		// 左列
		{ value: data.towerFloor.toString(), label: "塔", row: 0, col: 0 },
		{
			value: data.characterCount.toString(),
			label: "作戰人員",
			row: 1,
			col: 0
		},
		{ value: data.registrationDate, label: "註冊日期", row: 2, col: 0 },

		// 中列
		{
			value: data.normalProgress,
			label: "戰役",
			row: 0,
			col: 1,
			subLabel: "NORMAL"
		},
		{
			value: data.teamCombat.toLocaleString(),
			label: "部隊戰鬥力",
			row: 1,
			col: 1
		},
		{ value: data.syncLevel.toString(), label: "同步等級", row: 2, col: 1 },

		// 右列
		{
			value: data.hardProgress,
			label: "戰役",
			row: 0,
			col: 2,
			subLabel: "HARD"
		},
		{ value: data.costume.toString(), label: "時裝", row: 1, col: 2 },
		{
			value: data.lastActionDate,
			label: "上次上線",
			row: 2,
			col: 2
		}
	];

	// 繪製每個項目
	basicItems.forEach(item => {
		const cellX = x + item.col * cellWidth;
		const cellY = y + 100 + item.row * cellHeight;

		// 子標籤（如果有的話）
		if (item.subLabel) {
			ctx.fillStyle = "#87ceeb";
			ctx.font = getFontString(24, "normal", item.subLabel);
			ctx.textAlign = "center";
			ctx.fillText(item.subLabel, cellX + cellWidth / 2, cellY + 40);
		}

		// 數值
		ctx.fillStyle = "#ffffff";
		ctx.font = getFontString(48, "bold", item.value);
		ctx.textAlign = "center";
		ctx.fillText(item.value, cellX + cellWidth / 2, cellY + 100);

		// 標籤
		ctx.fillStyle = "#ffffff";
		ctx.font = getFontString(28, "normal", item.label);
		ctx.textAlign = "center";
		ctx.fillText(item.label, cellX + cellWidth / 2, cellY + 140);
	});

	// 返回更新後的 y 坐標
	return y + sectionHeight + 180;
}

/**
 * 繪製每日任務區域
 */
async function drawDailyMissionsSection(
	ctx: any,
	y: number,
	data: ProfileData,
	images: { backgroundImages: any[]; uiImages: any[]; characterImage: any }
): Promise<number> {
	const x = 100;
	const sectionWidth = 1400;
	const sectionHeight = 680;

	// 標題背景
	ctx.drawImage(
		images.uiImages[1],
		x + sectionWidth / 2 - sectionWidth / 4,
		y - 24,
		sectionWidth / 2,
		88
	);

	// 標題
	ctx.fillStyle = "#4a90e2";
	ctx.font = getFontString(52, "bold", "每日任務");
	ctx.textAlign = "center";
	ctx.fillText("每日任務", x + sectionWidth / 2, y + 40);

	// 背景面板
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(x, y + 80, sectionWidth, sectionHeight);
	ctx.strokeStyle = "#ddd";
	ctx.lineWidth = 2;
	ctx.strokeRect(x, y + 80, sectionWidth, sectionHeight);

	// 前哨防禦進度條
	await drawOutpostDefenseProgress(
		ctx,
		x + 40,
		y + 120,
		sectionWidth - 80,
		120,
		data.outpostDefense,
		data,
		images
	);

	// 每日任務網格
	const taskY = y + 380;
	const taskItems = [
		{ label: "攔截戰", value: `${data.intercept}/3`, x: 0, y: 0 },
		{
			label: "新人競技場",
			subLabel: "每日免費次數",
			value: data.rookieArena.toString(),
			x: 1,
			y: 0
		},
		{
			label: "特殊競技場",
			subLabel: "每日免費次數",
			value: data.specialArena.toString(),
			x: 2,
			y: 0
		},
		{ label: "諮詢次數", value: `${data.consultations}/10`, x: 0, y: 1 },
		{
			label: "派遣",
			subLabel: "可領取/派遣中",
			value: `${data.dispatchCompleted}/${data.dispatchInProgress}`,
			x: 1,
			y: 1
		},
		{ label: "企業塔", value: data.tribeTower, x: 2, y: 1 },
		{
			label: "模擬室",
			subLabel: "今日記錄",
			value: data.simulationRoom,
			x: 0,
			y: 2
		},
		{
			label: "雙週獎勵記錄",
			value: `${data.biWeeklyReward}/25`,
			x: 1,
			y: 2
		},
		{
			label: "賽季最高紀錄",
			value: data.seasonHighRecord.toString(),
			x: 2,
			y: 2
		}
	];

	const taskColWidth = (sectionWidth - 80) / 3;
	const taskRowHeight = 120;

	taskItems.forEach(item => {
		const itemX = x + 40 + item.x * taskColWidth;
		const itemY = taskY + item.y * taskRowHeight;

		// 背景
		ctx.fillStyle = "#f8f8f8";
		ctx.fillRect(itemX, itemY, taskColWidth - 20, taskRowHeight - 10);

		// 標籤
		ctx.fillStyle = "#333333";
		ctx.font = getFontString(32, "normal", item.label);
		ctx.textAlign = "center";
		ctx.fillText(item.label, itemX + taskColWidth / 2, itemY + 35);

		// 數值和子標籤
		if (item.subLabel) {
			// 子標籤 - 灰色較小字體，顯示在數值下方
			ctx.fillStyle = "#8a8a8a";
			ctx.font = getFontString(24, "normal", item.subLabel);
			ctx.textAlign = "center";
			ctx.fillText(item.subLabel, itemX + taskColWidth / 2, itemY + 100);

			// 數值 - 藍色，居中顯示
			ctx.fillStyle = "#4a90e2";
			ctx.font = getFontString(40, "bold", item.value);
			ctx.textAlign = "center";
			ctx.fillText(item.value, itemX + taskColWidth / 2, itemY + 75);
		} else {
			// 只有數值 - 居中顯示
			ctx.fillStyle = "#4a90e2";
			ctx.font = getFontString(40, "bold", item.value);
			ctx.textAlign = "center";
			ctx.fillText(item.value, itemX + taskColWidth / 2, itemY + 85);
		}
	});

	// 返回更新後的 y 坐標
	return y + sectionHeight + 120;
}

/**
 * 繪製前哨防禦進度條
 */
async function drawOutpostDefenseProgress(
	ctx: any,
	x: number,
	y: number,
	width: number,
	height: number,
	progress: number,
	data: ProfileData,
	images: { backgroundImages: any[]; uiImages: any[]; characterImage: any }
): Promise<void> {
	// 圖示 - 藍白相間的盒子圖示
	const iconSize = height * 0.8;
	const iconY = y + (height - iconSize) / 2;
	const paddingX = 40;
	const iconX = x;

	// 繪製盒子圖示
	ctx.drawImage(
		images.uiImages[3],
		iconX + paddingX / 2,
		iconY - 10,
		iconSize,
		iconSize
	);

	// 標題 - 移到圖示右側
	const titleX = iconX + iconSize + paddingX;
	ctx.fillStyle = "#333333";
	ctx.font = getFontString(36, "normal", "OUTPOST DEFENSE");
	ctx.textAlign = "left";
	ctx.fillText("OUTPOST DEFENSE", titleX, y + 50);

	// 進度條背景 - 淺灰色（未達到部分）
	ctx.fillStyle = "#e0e0e0";
	const progressBarY = y + 75;
	const progressBarHeight = 10;
	const totalProgressWidth = width - iconSize - paddingX * 2;
	ctx.fillRect(titleX, progressBarY, totalProgressWidth, progressBarHeight);

	// 進度條填充 - 藍色（已達到部分）
	const limitedProgress = Math.min(progress, 100); // 限制最大進度為100
	const progressWidth = (totalProgressWidth * limitedProgress) / 100;
	ctx.fillStyle = "#3eafff";
	ctx.fillRect(titleX, progressBarY, progressWidth, progressBarHeight);

	// 進度百分比 - 右對齊
	ctx.fillStyle = "#333333";
	ctx.font = getFontString(60, "bold", `${limitedProgress.toFixed(2)}%`);
	ctx.textAlign = "right";
	ctx.fillText(
		`${limitedProgress.toFixed(2)}%`,
		x + width - paddingX,
		y + 45
	);

	// 分隔線
	ctx.fillStyle = "#8a8a8a";
	ctx.fillRect(x, y + 115, width, 1);

	// 里程碑標記點
	const milestones = [0, 20, 40, 60, 80, 100];
	const milestoneLineY = y + 180;

	// 繪製里程碑線 - 根據進度改變顏色
	const totalLineWidth = x + width - paddingX - titleX;
	const missionProgress = Math.min(data.dailyMissionReceivedPoints, 100); // 限制最大進度為100
	const achievedLineWidth = (totalLineWidth * missionProgress) / 100;

	// 未達成部分 - 灰色
	ctx.strokeStyle = "#e0e0e0";
	ctx.lineWidth = 10;
	ctx.beginPath();
	ctx.moveTo(titleX + achievedLineWidth, milestoneLineY);
	ctx.lineTo(x + width - paddingX, milestoneLineY);
	ctx.stroke();

	// 已達成部分 - 藍色
	if (achievedLineWidth > 0) {
		ctx.strokeStyle = "#3eafff";
		ctx.lineWidth = 10;
		ctx.beginPath();
		ctx.moveTo(titleX, milestoneLineY);
		ctx.lineTo(titleX + achievedLineWidth, milestoneLineY);
		ctx.stroke();
	}

	const milestoneImage = images.uiImages[4];
	const pointImage = images.uiImages[5];
	const milestoneIconSize = 60;

	// 繪製里程碑點和標籤
	milestones.forEach((milestone, index) => {
		const milestoneX =
			titleX +
			(index * (width - iconSize - paddingX * 2)) /
				(milestones.length - 1);

		// 判斷是否已達到該里程碑
		const isAchieved = missionProgress >= milestone;
		const iconColor = isAchieved ? 1 : 0.5; // 已達到為正常亮度，未達到為半透明

		// 繪製里程碑點
		if (index == 0) {
			ctx.globalAlpha = iconColor;
			ctx.drawImage(
				pointImage,
				milestoneX - milestoneIconSize / 2,
				milestoneLineY - milestoneIconSize / 2,
				milestoneIconSize,
				milestoneIconSize
			);
			ctx.globalAlpha = 1;

			// 繪製標籤
			ctx.fillStyle = isAchieved ? "#3eafff" : "#8a8a8a";
			ctx.font = getFontString(
				28,
				"BOLD",
				`${data.dailyMissionReceivedPoints}(+${data.dailyMissionReceivablePoints})/100`
			);
			ctx.textAlign = "center";
			ctx.fillText(
				`${data.dailyMissionReceivedPoints}(+${data.dailyMissionReceivablePoints})/100`,
				milestoneX,
				milestoneLineY + milestoneIconSize
			);
		} else {
			ctx.globalAlpha = iconColor;
			ctx.drawImage(
				milestoneImage,
				milestoneX - milestoneIconSize / 2,
				milestoneLineY - milestoneIconSize / 2,
				milestoneIconSize,
				milestoneIconSize
			);
			ctx.globalAlpha = 1;

			// 繪製標籤
			ctx.fillStyle = isAchieved ? "#3eafff" : "#8a8a8a";
			ctx.font = getFontString(28, "BOLD", `${milestone}P`);
			ctx.textAlign = "center";
			ctx.fillText(
				`${milestone}P`,
				milestoneX,
				milestoneLineY + milestoneIconSize
			);
		}
	});
}

/**
 * 繪製前哨資訊區域
 */
async function drawOutpostInfoSection(
	ctx: any,
	y: number,
	data: ProfileData,
	images: { backgroundImages: any[]; uiImages: any[]; characterImage: any }
): Promise<number> {
	const x = 100;
	const sectionWidth = 1400;
	const sectionHeight = 280;

	// 標題背景
	ctx.drawImage(
		images.uiImages[1],
		x + sectionWidth / 2 - sectionWidth / 4,
		y - 24,
		sectionWidth / 2,
		88
	);

	// 標題
	ctx.fillStyle = "#4a90e2";
	ctx.font = getFontString(52, "bold", "前哨資訊");
	ctx.textAlign = "center";
	ctx.fillText("前哨資訊", x + sectionWidth / 2, y + 40);

	// 背景面板
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(x, y + 80, sectionWidth, sectionHeight);
	ctx.strokeStyle = "#ddd";
	ctx.lineWidth = 2;
	ctx.strokeRect(x, y + 80, sectionWidth, sectionHeight);

	// 前哨資訊項目
	const outpostItems = [
		{ label: "同步等級", value: `${data.syncLevel}` },
		{ label: "米西利斯", value: `${data.missilis}` },
		{ label: "通用研究", value: `${data.generalResearch}` },
		{ label: "極樂淨土", value: `${data.elysion}` },
		{ label: "火力型", value: `${data.attackerType}` },
		{ label: "泰特拉", value: `${data.tetra}` },
		{ label: "防禦型", value: `${data.defenderType}` },
		{ label: "朝聖者", value: `${data.pilgrim}` },
		{ label: "輔助型", value: `${data.supportType}` },
		{ label: "反常", value: `${data.abnormal}` }
	];

	const itemWidth = sectionWidth / 2;
	const itemHeight = 50;

	outpostItems.forEach((item, index) => {
		const itemX = x + 20 + (index % 2) * itemWidth;
		const itemY = y + 140 + Math.floor(index / 2) * itemHeight;

		// 標籤
		ctx.fillStyle = "#333333";
		ctx.font = getFontString(40, "bold", item.label);
		ctx.textAlign = "left";
		ctx.fillText(item.label, itemX, itemY);

		// 數值
		ctx.fillStyle = "#4a90e2";
		ctx.font = getFontString(40, "bold", item.value);
		ctx.textAlign = "right";
		ctx.fillText(item.value, itemX + itemWidth - 80, itemY);

		// Lv 標籤
		ctx.fillStyle = "#8a8a8a";
		ctx.font = getFontString(32, "normal", "Lv");
		ctx.textAlign = "left";
		ctx.fillText("Lv", itemX + itemWidth - 70, itemY);
	});

	// 返回更新後的 y 坐標
	return y + sectionHeight + 40;
}

/**
 * 從 API 回應數據創建 ProfileData 對象
 */
export function createProfileDataFromApi(
	basicInfo: any,
	outpostInfo: any,
	dailyProgress: any,
	accountName: string,
	areaId: number
): ProfileData {
	// 根據實際的 API 回應結構來映射數據

	// 基本資料映射
	const basic = basicInfo?.data?.basic_info || {};

	// 前哨站資料映射
	const outpost = outpostInfo?.data?.outpost_info || {};

	// 每日進度資料映射 (daily_progress 是一個陣列，取第一個元素)
	const daily = dailyProgress?.data?.daily_progress?.[0] || {};

	// 格式化日期
	const formatDate = (timestamp: string | number) => {
		if (!timestamp) return "2024-01-01";
		const date = new Date(parseInt(timestamp.toString()) * 1000);
		return date.toISOString().split("T")[0];
	};

	// 格式化戰役進度
	const formatCampaignProgress = (progress: number) => {
		if (!progress) return "1-1";

		// 在章節數據中查找對應的關卡名稱
		const chapter = chapterData.find(
			(chapter: any) => chapter.id === progress
		);
		if (chapter && chapter.name_localkey && chapter.name_localkey.name) {
			return chapter.name_localkey.name.replace(
				/ (STAGE|BOSS|HARD STAGE)$/,
				""
			);
		}

		// 如果找不到對應的章節，返回原始 ID
		return progress.toString();
	};

	return {
		playerName: basic.role_name || accountName,
		playerLevel: basic.lv || 1,
		playerId: basic.gsn || "N/A",
		areaId: areaId,
		iconId: basic.icon_id || 52000, // 預設使用 52000

		// 遊戲進度
		towerFloor: basic.progress_tribe_tower || 0,
		normalProgress: formatCampaignProgress(basic.progress_normal_campaign),
		hardProgress: formatCampaignProgress(basic.progress_hard_campaign),
		teamCombat: basic.team_combat || 0,
		syncLevel: outpost.synchro_level || basic.lv || 1,
		costume: basic.character_costume_count || 0,
		overclockMode:
			basic.sim_room_overclock_current_sub_season_high_score || 0,
		registrationDate: formatDate(basic.created_at) || "2024-01-01",
		lastActionDate: formatDate(basic.last_action_at) || "2024-01-01",
		characterCount: basic.character_count || 0,

		// 每日任務進度
		outpostDefense: daily.outpost_battle_storage_fullness * 100 || 0,
		intercept: daily.intercept_remaining_tickets || 0,
		rookieArena: daily.rookie_arena_remaining_count || 0,
		specialArena: daily.special_arena_remaining_count || 0,
		consultations: daily.counsel_remaining_count || 0,
		dispatchInProgress: daily.dispatch_in_progress_count || 0,
		dispatchCompleted: daily.dispatch_completed_count || 0,
		tribeTower: (() => {
			if (
				!daily.tower_daily_info_list ||
				!Array.isArray(daily.tower_daily_info_list)
			) {
				return "0/0";
			}
			const openedTowers = daily.tower_daily_info_list.filter(
				(tower: any) => tower.is_opened === true
			);
			const totalCount = openedTowers.length * 3;
			const remainingCount = openedTowers.reduce(
				(sum: number, tower: any) => sum + (tower.remaining_count || 0),
				0
			);

			return `${remainingCount}/${totalCount}`;
		})(),
		simulationRoom: daily.sim_room_daily_best_record
			? `${daily.sim_room_daily_best_record.difficulty}-${String.fromCharCode(64 + daily.sim_room_daily_best_record.chapter)}`
			: "1-A",
		biWeeklyReward: daily.weekly_mission_received_points || 0,
		seasonHighRecord:
			basic.sim_room_overclock_latest_season_high_score || 0,
		dailyMissionReceivedPoints: daily.daily_mission_received_points || 0,
		dailyMissionReceivablePoints:
			daily.daily_mission_receivable_points || 0,

		// 前哨資訊
		generalResearch: outpost.recycle_room_researches[0].lv || 1,
		attackerType: outpost.recycle_room_researches[1].lv || 1,
		defenderType: outpost.recycle_room_researches[2].lv || 1,
		supportType: outpost.recycle_room_researches[3].lv || 1,
		missilis: outpost.recycle_room_researches[4].lv || 1,
		elysion: outpost.recycle_room_researches[5].lv || 1,
		tetra: outpost.recycle_room_researches[6].lv || 1,
		pilgrim: outpost.recycle_room_researches[7].lv || 1,
		abnormal: outpost.recycle_room_researches[8].lv || 1
	};
}
