export const areaNameMap = {
	83: "韓國",
	81: "日本",
	84: "國際",
	82: "北美",
	85: "東南亞",
	91: "台港澳"
};

export const elementNameMap = {
	Fire: "燃燒",
	Iron: "鐵甲",
	Water: "水冷",
	Wind: "風壓",
	Electronic: "電擊"
};

export const burstSkillNameMap = {
	Step1: "爆裂1",
	Step2: "爆裂2",
	Step3: "爆裂3",
	AllStep: "全爆裂"
};

export const cubeNameMap = {
	cubes: [
		{ cube_id: 1000301, name_cn: "遺跡突擊魔方", name_en: "Assault Cube" },
		{
			cube_id: 1000302,
			name_cn: "戰術突擊魔方",
			name_en: "Onslaught Cube"
		},
		{
			cube_id: 1000303,
			name_cn: "遺跡巨熊魔方",
			name_en: "Resilience Cube"
		},
		{ cube_id: 1000304, name_cn: "戰術巨熊魔方", name_en: "Bastion Cube" },
		{ cube_id: 1000305, name_cn: "遺跡促進魔方", name_en: "Adjutant Cube" },
		{ cube_id: 1000306, name_cn: "戰術促進魔方", name_en: "Wingman Cube" },
		{ cube_id: 1000307, name_cn: "遺跡量子魔方", name_en: "Quantum Cube" },
		{ cube_id: 1000308, name_cn: "體力神器魔方", name_en: "Vigor Cube" },
		{
			cube_id: 1000309,
			name_cn: "遺跡強韌魔方",
			name_en: "Endurance Cube"
		},
		{ cube_id: 1000310, name_cn: "遺跡治療魔方", name_en: "Healing Cube" },
		{
			cube_id: 1000311,
			name_cn: "遺跡回火魔方",
			name_en: "Tempering Cube"
		},
		{
			cube_id: 1000312,
			name_cn: "遺跡輔助魔方",
			name_en: "Relic Assist Cube"
		},
		{
			cube_id: 1000313,
			name_cn: "遺跡毀滅魔方",
			name_en: "Destruction Cube"
		},
		{ cube_id: 1000314, name_cn: "遺跡穿透魔方", name_en: "Piercing Cube" }
	]
};

/**
 * 獲取字體字符串，優先使用 DINNextLTPro，如果包含中文字符則回退到 YaHei
 */
export const getFontString = (
	fontSize: number,
	weight: string = "normal",
	text: string = ""
): string => {
	const hasChinese = /[\u4e00-\u9fff]/.test(text);
	const fontFamily = hasChinese ? "YaHei" : "DINNextLTPro";
	return `${weight} ${fontSize}px '${fontFamily}'`;
};

interface ApiResponse<T = any> {
	code: number;
	code_type: number;
	msg: string;
	data: T | null;
	seq: string;
}

interface UserProfileBasicInfo {
	// 基本資料結構，根據 API 回應調整
	[key: string]: any;
}

interface UserProfileOutpostInfo {
	// 前哨站資料結構，根據 API 回應調整
	[key: string]: any;
}

interface UserDailyContentsProgress {
	// 每日內容進度結構，根據 API 回應調整
	[key: string]: any;
}

/**
 * 構建請求標頭
 */
function buildHeader(cookie: string) {
	return {
		"Content-Type": "application/json",
		Accept: "application/json, text/plain, */*",
		"Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,zh-CN;q=0.6",
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
		"X-Channel-Type": "2",
		Cookie: cookie
	};
}

/**
 * 發送 POST JSON 請求
 */
async function postJson<T>(
	url: string,
	bodyObj: any,
	cookie: string
): Promise<T> {
	const response = await fetch(url, {
		method: "POST",
		headers: buildHeader(cookie),
		body: JSON.stringify(bodyObj),
		credentials: "include"
	});

	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}

	return response.json();
}

/**
 * 獲取用戶基本資料
 */
export async function getUserProfileBasicInfo(
	intl_open_id: string,
	nikke_area_id: number,
	cookie: string
): Promise<ApiResponse<UserProfileBasicInfo> | null> {
	try {
		const requestBody = {
			intl_open_id,
			nikke_area_id
		};

		const response = await postJson<ApiResponse<UserProfileBasicInfo>>(
			"https://api.blablalink.com/api/game/proxy/Game/GetUserProfileBasicInfo",
			requestBody,
			cookie
		);

		return response;
	} catch (error) {
		console.warn("獲取用戶基本資料失敗", error);
		return null;
	}
}

/**
 * 獲取用戶前哨站資料
 */
export async function getUserProfileOutpostInfo(
	intl_open_id: string,
	nikke_area_id: number,
	cookie: string
): Promise<ApiResponse<UserProfileOutpostInfo> | null> {
	try {
		const requestBody = {
			intl_open_id,
			nikke_area_id
		};

		const response = await postJson<ApiResponse<UserProfileOutpostInfo>>(
			"https://api.blablalink.com/api/game/proxy/Game/GetUserProfileOutpostInfo",
			requestBody,
			cookie
		);

		return response;
	} catch (error) {
		console.warn("獲取用戶前哨站資料失敗", error);
		return null;
	}
}

/**
 * 獲取用戶每日內容進度
 */
export async function getUserDailyContentsProgress(
	intl_open_id: string,
	nikke_area_id: number,
	cookie: string
): Promise<ApiResponse<UserDailyContentsProgress> | null> {
	try {
		const requestBody = {
			intl_open_id,
			nikke_area_id
		};

		const response = await postJson<ApiResponse<UserDailyContentsProgress>>(
			"https://api.blablalink.com/api/game/proxy/Game/GetUserDailyContentsProgress",
			requestBody,
			cookie
		);

		return response;
	} catch (error) {
		console.warn("獲取用戶每日內容進度失敗", error);
		return null;
	}
}

/**
 * 獲取用戶角色資料
 */
export async function getUserCharacters(
	intl_open_id: string,
	nikke_area_id: number,
	cookie: string
): Promise<ApiResponse<any> | null> {
	try {
		const requestBody = {
			intl_open_id,
			nikke_area_id
		};

		const response = await postJson<ApiResponse<any>>(
			"https://api.blablalink.com/api/game/proxy/Game/GetUserCharacters",
			requestBody,
			cookie
		);

		return response;
	} catch (error) {
		console.warn("獲取用戶角色資料失敗", error);
		return null;
	}
}

/**
 * 獲取角色詳細資料
 */
export async function getUserCharacterDetails(
	intl_open_id: string,
	nikke_area_id: number,
	name_codes: number[],
	cookie: string
): Promise<ApiResponse<any> | null> {
	try {
		const requestBody = {
			intl_open_id,
			nikke_area_id,
			name_codes
		};

		const response = await postJson<ApiResponse<any>>(
			"https://api.blablalink.com/api/game/proxy/Game/GetUserCharacterDetails",
			requestBody,
			cookie
		);

		return response;
	} catch (error) {
		console.warn("獲取角色詳細資料失敗", error);
		return null;
	}
}

export type {
	ApiResponse,
	UserProfileBasicInfo,
	UserProfileOutpostInfo,
	UserDailyContentsProgress
};
