export const areaNameMap = {
	83: "韓國",
	81: "日本",
	84: "國際",
	82: "北美",
	85: "東南亞",
	91: "台港澳"
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

export type {
	ApiResponse,
	UserProfileBasicInfo,
	UserProfileOutpostInfo,
	UserDailyContentsProgress
};
