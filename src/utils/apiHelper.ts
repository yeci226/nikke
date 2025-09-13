interface GamePlayerInfo {
	code: number;
	code_type: number;
	msg: string;
	data: {
		area_id: string;
		avatar_frame: number;
		costume: number;
		guild_name: string;
		hard_progress: number;
		has_saved_role_info: boolean;
		icon: number;
		is_banned: boolean;
		is_maintenance: boolean;
		normal_progress: number;
		own_nikke_cnt: number;
		player_level: number;
		role_name: string;
		team_combat: number;
		tower_floor: number;
	};
	seq: string;
}

interface AccountInfo {
	name: string;
	nikke_area_id: string;
	cookie: string;
}

/**
 * 使用 cookie 獲取遊戲玩家資訊
 */
export async function getUserGamePlayerInfo(
	cookie: string
): Promise<GamePlayerInfo | null> {
	try {
		const response = await fetch(
			"https://api.blablalink.com/api/ugc/direct/standalonesite/User/GetUserGamePlayerInfo",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: cookie
				},
				body: JSON.stringify({})
			}
		);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = (await response.json()) as GamePlayerInfo;

		// 檢查 API 回應是否成功
		if (data.code === 0 && data.data) {
			return data;
		} else {
			throw new Error(`API error: ${data.msg || "Unknown error"}`);
		}
	} catch (error) {
		console.error("獲取遊戲玩家資訊失敗:", error);
		return null;
	}
}

/**
 * 從遊戲玩家資訊中提取帳戶資訊
 */
export function extractAccountInfo(
	gameInfo: GamePlayerInfo,
	cookie: string
): AccountInfo {
	return {
		name: gameInfo.data.role_name,
		nikke_area_id: gameInfo.data.area_id,
		cookie: cookie
	};
}

export type { GamePlayerInfo, AccountInfo };
