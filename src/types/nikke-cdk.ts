// NIKKE CDK工具类型定义

// 国际服请求头类型
export interface GlobalHeaders {
	"x-channel-type": string;
	"x-language": string;
	"x-common-params": string;
}

// 国服API端点配置
export interface CnEndpoints {
	CDK_EXCHANGE: string;
	CAPTCHA: string;
	LOG: string;
}

// CORS响应头类型
export interface CorsHeaders {
	"Access-Control-Allow-Origin": string;
	"Access-Control-Allow-Methods": string;
	"Access-Control-Allow-Headers": string;
	"Access-Control-Allow-Credentials": string;
	"Access-Control-Max-Age": string;
	[key: string]: string;
}

// Cookie续期请求类型
export interface CookieRenewalRequest {
	cookie: string;
	requestBody: any;
}

// Cookie续期响应类型
export interface CookieRenewalResponse {
	success: boolean;
	message?: string;
	msg?: string;
	data?: {
		newCookie: string;
		expireAt: string;
		maxAge: number;
		totalCookies: number;
		hasGameToken: boolean;
		expireDays?: number | undefined;
		added: Array<{ key: string; value: string }>;
		changed: Array<{ key: string; old: string; new: string }>;
	};
}

// 国际服角色信息请求类型
export interface GlobalPlayerInfoRequest {
	cookie: string;
	payload: any;
}

// 国际服区域列表请求类型
export interface GlobalRegionListRequest {
	cookie: string;
	game_id: string;
}

// 国际服CDK兑换请求类型
export interface GlobalCdkExchangeRequest {
	cdkey: string;
	cookie: string;
}

// 国际服兑换历史请求类型
export interface GlobalHistoryRequest {
	cookie: string;
	page_num?: number;
	page_size?: number;
}

// 国服验证码请求类型
export interface CnCaptchaRequest {
	aid: string;
}

// 国服验证码响应类型
export interface CnCaptchaResponse {
	success: boolean;
	captchaUrl?: string;
	aid?: string;
	verifysession?: string | undefined;
	message?: string;
}

// 国服CDK兑换请求类型
export interface CnCdkExchangeRequest {
	sPassword: string;
	sCode: string;
	role_id: string;
	area_id: string;
	iChartId?: string;
	iSubChartId?: string;
	sIdeToken?: string;
	cookie?: string;
	verifysession?: string;
	[key: string]: any;
}

// 国服日志记录请求类型
export interface CnLogRequest {
	[key: string]: any;
}

// 通用API响应类型
export interface ApiResponse<T = any> {
	code?: number;
	success?: boolean;
	msg?: string;
	message?: string;
	data?: T;
}

// 健康检查响应类型
export interface HealthCheckResponse {
	status: string;
	message: string;
	timestamp: string;
	services?: {
		global: string;
		cn: string;
	};
	endpoints?: {
		[key: string]: string;
	};
}

// 错误响应类型
export interface ErrorResponse {
	error: string;
	message: string;
	available_endpoints: string[];
}
