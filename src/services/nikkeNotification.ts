import { Logger } from "./logger.js";
import databaseService from "./database.js";
import { getNotificationSettings } from "../commands/notification.js";
import { Client, EmbedBuilder, TextChannel } from "discord.js";
import fetch from "node-fetch";

const logger = new Logger("NIKKE通知服務");

interface SentMessage {
	messageId: string;
	postUuid: string;
	channelId: string;
	guildId: string;
	sentAt: number;
	lastModified: string; // 對應 post 的 modified_on
}

interface BlablaPost {
	ai_content_type: number;
	area_id: string;
	browse_count: string;
	can_delete: boolean;
	can_edit: boolean;
	can_edit_statement: boolean;
	can_move: boolean;
	can_report: boolean;
	can_update_tags: boolean;
	collection_count: string;
	comment_count: string;
	content: string;
	content_languages: string[];
	content_summary: string;
	created_on: string;
	created_on_ms: string;
	creator_statement_type: number;
	del_reason: number;
	del_type: number;
	essence_on: string;
	ext_info: string;
	forward_count: number;
	friend_card: any;
	game_id: string;
	game_name: string;
	guild_card: any;
	hot_num: number;
	intl_openid: string;
	is_audit: number;
	is_collection: boolean;
	is_comment: boolean;
	is_del: number;
	is_essence: number;
	is_follow: boolean;
	is_hide: number;
	is_mine: boolean;
	is_mutual_follow: boolean;
	is_official: number;
	is_original: number;
	is_original_content: boolean;
	is_top: number;
	language: string;
	latest_replied_on: string;
	modified_on: string;
	my_upvote: any;
	original_language: string;
	original_reprint: number;
	original_url: string;
	page_browse_count: string;
	pic_click_count: string;
	pic_urls: string[];
	plate_id: number;
	plate_name: string;
	platform: string;
	post_draft_uuid: string;
	post_uuid: string;
	power_num: number;
	publish_on: number;
	rank_info: {
		id: number;
		rank_name: string;
	};
	risk_remind_type: number;
	score: number;
	show_friend_icon: boolean;
	show_guild_icon: boolean;
	show_vote_icon: boolean;
	tags: Array<{
		id: string;
		name: string;
	}>;
	task_info: {
		id: number;
		task_id: number;
		task_name: string;
	};
	title: string;
	top_on: string;
	top_sort: number;
	type: number;
	upvote_count: string;
	upvote_map: Record<string, string>;
	user: {
		achieve_count: number;
		achievements: Array<{
			icon: string;
			id: string;
		}>;
		all_post_num: number;
		area_id: string;
		audit_avatar: string;
		audit_remark: string;
		audit_username: string;
		auth_desc: string[];
		auth_languages: string[];
		auth_type: number;
		avatar: string;
		avatar_pendant: string;
		cover_photo: string;
		created_on: number;
		fans_num: number;
		follow_num: number;
		game_adult_status: number;
		game_tag: number;
		game_tag_num: number;
		had_modified_username: boolean;
		has_sign_privacy: boolean;
		home_page_links: string;
		id: string;
		intl_openid: string;
		is_admin: boolean;
		is_audit_avatar: boolean;
		is_audit_remark: boolean;
		is_audit_username: boolean;
		is_black: number;
		is_first_register: boolean;
		is_followed: number;
		is_mute: boolean;
		is_mutual_follow: number;
		language: string;
		mood: string;
		post_num: number;
		regions: string[];
		remark: string;
		role_name: string;
		status: number;
		titles: any;
		user_infos_languages: string[];
		username: string;
	};
}

interface ApiResponse {
	code: number;
	code_type: number;
	msg: string;
	data: {
		list: BlablaPost[];
		page_info: {
			is_finish: boolean;
			next_page_cursor: string;
			previous_page_cursor: string;
			total: number;
		};
	};
	seq: string;
}

class NikkeNotificationService {
	private client: Client | null = null;
	private intervalId: NodeJS.Timeout | null = null;
	private isRunning = false;
	private readonly API_URL =
		"https://api.blablalink.com/api/ugc/direct/standalonesite/Dynamics/GetPostList";
	private readonly CHECK_INTERVAL = 30 * 60 * 1000; // 30 分鐘

	constructor() {
		logger.info("NIKKE 通知服務初始化");
	}

	/**
	 * 初始化服務
	 */
	public initialize(client: Client): void {
		this.client = client;
		logger.info("NIKKE 通知服務已連接到 Discord 客戶端");
	}

	/**
	 * 啟動定期檢查
	 */
	public start(): void {
		if (this.isRunning) {
			logger.warn("NIKKE 通知服務已在運行中");
			return;
		}

		if (!this.client) {
			logger.error("Discord 客戶端未初始化，無法啟動通知服務");
			return;
		}

		this.isRunning = true;

		// 立即執行一次檢查
		this.checkForNewPosts().catch(error => {
			logger.error("初始檢查失敗", { error });
		});

		// 設定定期檢查
		this.intervalId = setInterval(() => {
			this.checkForNewPosts().catch(error => {
				logger.error("定期檢查失敗", { error });
			});
		}, this.CHECK_INTERVAL);

		logger.info(
			`NIKKE 通知服務已啟動，檢查間隔: ${this.CHECK_INTERVAL / 1000 / 60} 分鐘`
		);
	}

	/**
	 * 停止定期檢查
	 */
	public stop(): void {
		if (!this.isRunning) {
			logger.warn("NIKKE 通知服務未在運行中");
			return;
		}

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		this.isRunning = false;
		logger.info("NIKKE 通知服務已停止");
	}

	/**
	 * 檢查是否有新貼文
	 */
	private async checkForNewPosts(): Promise<void> {
		try {
			logger.debug("開始檢查新貼文");

			const posts = await this.fetchLatestPosts();
			if (!posts || posts.length === 0) {
				logger.debug("沒有獲取到貼文");
				return;
			}

			// 取得所有已設定通知的伺服器
			const guildsWithNotifications =
				await this.getAllNotificationGuilds();
			if (guildsWithNotifications.length === 0) {
				logger.debug("沒有伺服器設定通知");
				return;
			}

			// 檢查每個伺服器是否有新貼文需要通知
			for (const guildId of guildsWithNotifications) {
				await this.checkGuildForNewPosts(guildId, posts);
			}

			logger.debug("新貼文檢查完成");
		} catch (error) {
			logger.error("檢查新貼文時發生錯誤", { error });
		}
	}

	/**
	 * 從 API 獲取最新貼文
	 */
	private async fetchLatestPosts(): Promise<BlablaPost[] | null> {
		try {
			const payload = {
				search_type: 0,
				plate_id: 43,
				plate_unique_id: "official",
				order_by: 1,
				limit: "10",
				regions: ["all"]
			};

			const response = await fetch(this.API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
					"X-Language": "zh-TW"
				},
				body: JSON.stringify(payload)
			});

			if (!response.ok) {
				logger.error(
					`API 請求失敗: ${response.status} ${response.statusText}`
				);
				return null;
			}

			const data = (await response.json()) as ApiResponse;

			if (data.code !== 0) {
				logger.error(`API 回應錯誤: ${data.msg}`);
				return null;
			}

			if (!data.data || !data.data.list) {
				logger.warn("API 回應中沒有貼文列表");
				return null;
			}

			logger.debug(`成功獲取 ${data.data.list.length} 則貼文`);
			return data.data.list;
		} catch (error) {
			logger.error("獲取貼文時發生錯誤", { error });
			return null;
		}
	}

	/**
	 * 取得所有設定通知的伺服器
	 */
	private async getAllNotificationGuilds(): Promise<string[]> {
		try {
			const db = databaseService.getDB();
			if (!db) return [];

			const allData = await db.all();
			const notificationKeys = allData
				.filter(
					(item: { id: string; value: any }) =>
						item.id.startsWith("notification_") &&
						item.value &&
						item.value.enabled
				)
				.map((item: { id: string; value: any }) =>
					item.id.replace("notification_", "")
				);

			return notificationKeys;
		} catch (error) {
			logger.error("取得通知伺服器列表失敗", { error });
			return [];
		}
	}

	/**
	 * 檢查特定伺服器是否有新貼文需要通知
	 */
	private async checkGuildForNewPosts(
		guildId: string,
		posts: BlablaPost[]
	): Promise<void> {
		try {
			const settings = await getNotificationSettings(guildId);
			if (!settings || !settings.enabled) {
				return;
			}

			// 取得最新的貼文
			const latestPost = posts[0];
			if (!latestPost) {
				return;
			}

			// 檢查是否已經發送過這則貼文
			const sentMessage = await this.getSentMessage(
				guildId,
				latestPost.post_uuid
			);

			if (!sentMessage) {
				// 新貼文，直接發送
				const messageId = await this.sendNotification(
					guildId,
					settings.channelId,
					latestPost
				);
				if (messageId) {
					// 記錄已發送的訊息
					await this.saveSentMessage({
						messageId,
						postUuid: latestPost.post_uuid,
						channelId: settings.channelId,
						guildId,
						sentAt: Date.now(),
						lastModified: latestPost.modified_on
					});

					// 更新最後貼文 ID
					await this.updateLastPostId(guildId, latestPost.post_uuid);

					logger.info(
						`已向伺服器 ${guildId} 發送新貼文通知: ${latestPost.title}`
					);
				}
			} else if (sentMessage.lastModified !== latestPost.modified_on) {
				// 貼文已被編輯，嘗試更新訊息
				logger.info(
					`偵測到貼文編輯 (伺服器: ${guildId}, 貼文: ${latestPost.post_uuid})`
				);

				const updateSuccess = await this.updateSentMessage(
					sentMessage,
					latestPost
				);

				if (updateSuccess) {
					// 更新記錄中的 modified_on
					sentMessage.lastModified = latestPost.modified_on;
					await this.saveSentMessage(sentMessage);
					logger.info(`已更新編輯後的貼文: ${latestPost.title}`);
				} else {
					// 無法編輯，發送新訊息
					const newMessageId = await this.sendNotification(
						guildId,
						settings.channelId,
						latestPost,
						true
					);
					if (newMessageId) {
						// 更新記錄
						sentMessage.messageId = newMessageId;
						sentMessage.lastModified = latestPost.modified_on;
						sentMessage.sentAt = Date.now();
						await this.saveSentMessage(sentMessage);
						logger.info(
							`無法編輯原訊息，已發送新的編輯通知: ${latestPost.title}`
						);
					}
				}
			}
		} catch (error) {
			logger.error(`檢查伺服器 ${guildId} 新貼文失敗`, { error });
		}
	}

	/**
	 * 發送通知到指定頻道
	 */
	private async sendNotification(
		guildId: string,
		channelId: string,
		post: BlablaPost,
		isEdit: boolean = false
	): Promise<string | null> {
		try {
			if (!this.client) {
				logger.error("Discord 客戶端未初始化");
				return null;
			}

			const channel = this.client.channels.cache.get(
				channelId
			) as TextChannel;
			if (!channel) {
				logger.error(`找不到頻道 ${channelId} (伺服器: ${guildId})`);
				return null;
			}

			// 解析 HTML 內容
			const cleanContent = this.parseHtmlContent(post.content);

			// 建立多個 embed 來支援多張圖片（最多4張）
			const embeds: EmbedBuilder[] = [];
			const maxImages = 4;
			const imageUrls =
				post.pic_urls && post.pic_urls.length > 0
					? post.pic_urls.slice(0, maxImages).filter(url => url)
					: [];

			// 建立主要 embed（包含所有資訊）
			const postUrl = `https://www.blablalink.com/post/detail?post_uuid=${post.post_uuid}`;
			const titlePrefix = isEdit ? "📝 [已編輯] " : "";
			const mainEmbed = new EmbedBuilder()
				.setColor(isEdit ? 0xffa500 : 0x00ff88) // 編輯後的貼文使用橙色
				.setTitle(`${titlePrefix}${post.title}`)
				.setURL(postUrl) // 使用實際的貼文 URL
				.setDescription(
					cleanContent.length > 2000
						? cleanContent.substring(0, 2000) + "..."
						: cleanContent
				)
				.setAuthor({
					name: post.user.username,
					iconURL: post.user.avatar
				})
				.setTimestamp(new Date(parseInt(post.created_on) * 1000))
				.setFooter({
					text: `NIKKE 官方通知 | ${post.browse_count}👀 | ${post.upvote_count}👍 | ${post.comment_count}💬 `
				});

			// 添加標籤（如果有的話）
			if (post.tags && post.tags.length > 0) {
				const tagNames = post.tags.map(tag => `#${tag.name}`).join(" ");
				mainEmbed.addFields({
					name: "🏷️ 標籤",
					value: tagNames,
					inline: false
				});
			}

			// 如果有圖片，設置第一張圖片到主 embed
			if (imageUrls.length > 0 && imageUrls[0]) {
				mainEmbed.setImage(imageUrls[0]);
			}

			embeds.push(mainEmbed);

			// 為剩餘的圖片建立額外的 embed（最多3個額外的）
			for (let i = 1; i < imageUrls.length && i < maxImages; i++) {
				const imageUrl = imageUrls[i];
				if (imageUrl) {
					const imageEmbed = new EmbedBuilder()
						.setURL(postUrl) // 使用相同的貼文 URL
						.setImage(imageUrl);

					embeds.push(imageEmbed);
				}
			}

			const sentMessage = await channel.send({ embeds });
			return sentMessage.id;
		} catch (error) {
			logger.error(
				`發送通知失敗 (伺服器: ${guildId}, 頻道: ${channelId})`,
				{ error }
			);
			return null;
		}
	}

	/**
	 * 解析 HTML 內容
	 */
	private parseHtmlContent(htmlContent: string): string {
		// 移除 HTML 標籤並解碼實體
		let content = htmlContent
			.replace(/<div>/g, "\n")
			.replace(/<\/div>/g, "")
			.replace(/<br>/g, "\n")
			.replace(/<br\/>/g, "\n")
			.replace(/<img[^>]*>/g, "")
			.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g, "[$2]($1)")
			.replace(/<[^>]*>/g, "")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\n\s*\n/g, "\n")
			.trim();

		return content;
	}

	/**
	 * 更新最後貼文 ID
	 */
	private async updateLastPostId(
		guildId: string,
		postId: string
	): Promise<void> {
		try {
			const settings = await getNotificationSettings(guildId);
			if (!settings) return;

			settings.lastPostId = postId;
			settings.updatedAt = Date.now();

			const db = databaseService.getDB();
			if (!db) return;

			await db.set(`notification_${guildId}`, settings);
		} catch (error) {
			logger.error(`更新最後貼文 ID 失敗 (伺服器: ${guildId})`, {
				error
			});
		}
	}

	/**
	 * 取得服務狀態
	 */
	public getStatus(): { isRunning: boolean; checkInterval: number } {
		return {
			isRunning: this.isRunning,
			checkInterval: this.CHECK_INTERVAL
		};
	}

	/**
	 * 手動觸發檢查（用於測試）
	 */
	public async manualCheck(): Promise<void> {
		if (!this.client) {
			throw new Error("Discord 客戶端未初始化");
		}

		await this.checkForNewPosts();
	}

	/**
	 * 取得已發送的訊息記錄
	 */
	private async getSentMessage(
		guildId: string,
		postUuid: string
	): Promise<SentMessage | null> {
		try {
			const db = databaseService.getDB();
			if (!db) return null;

			const sentMessage = await db.get(
				`sent_message_${guildId}_${postUuid}`
			);
			return (sentMessage as SentMessage) || null;
		} catch (error) {
			logger.error(`取得已發送訊息記錄失敗 (${guildId}, ${postUuid})`, {
				error
			});
			return null;
		}
	}

	/**
	 * 儲存已發送的訊息記錄
	 */
	private async saveSentMessage(sentMessage: SentMessage): Promise<void> {
		try {
			const db = databaseService.getDB();
			if (!db) return;

			await db.set(
				`sent_message_${sentMessage.guildId}_${sentMessage.postUuid}`,
				sentMessage
			);
		} catch (error) {
			logger.error(`儲存已發送訊息記錄失敗`, { error, sentMessage });
		}
	}

	/**
	 * 更新已發送的訊息
	 */
	private async updateSentMessage(
		sentMessage: SentMessage,
		post: BlablaPost
	): Promise<boolean> {
		try {
			if (!this.client) {
				return false;
			}

			const channel = this.client.channels.cache.get(
				sentMessage.channelId
			) as TextChannel;
			if (!channel) {
				logger.error(`找不到頻道 ${sentMessage.channelId}`);
				return false;
			}

			// 嘗試取得原始訊息
			const originalMessage = await channel.messages
				.fetch(sentMessage.messageId)
				.catch(() => null);
			if (!originalMessage) {
				logger.warn(
					`找不到原始訊息 ${sentMessage.messageId}，可能已被刪除`
				);
				return false;
			}

			// 重新建立 embeds
			const cleanContent = this.parseHtmlContent(post.content);
			const embeds: EmbedBuilder[] = [];
			const maxImages = 4;
			const imageUrls =
				post.pic_urls && post.pic_urls.length > 0
					? post.pic_urls.slice(0, maxImages).filter(url => url)
					: [];

			const postUrl = `https://www.blablalink.com/post/detail?post_uuid=${post.post_uuid}`;
			const mainEmbed = new EmbedBuilder()
				.setColor(0xffa500) // 橙色表示已編輯
				.setTitle(`📝 [已編輯] ${post.title}`)
				.setURL(postUrl)
				.setDescription(
					cleanContent.length > 2000
						? cleanContent.substring(0, 2000) + "..."
						: cleanContent
				)
				.setAuthor({
					name: post.user.username,
					iconURL: post.user.avatar
				})
				.setTimestamp(new Date(parseInt(post.created_on) * 1000))
				.setFooter({
					text: `NIKKE 官方通知 (已編輯) | ${post.browse_count}👀 | ${post.upvote_count}👍 | ${post.comment_count}💬 `
				});

			// 添加標籤
			if (post.tags && post.tags.length > 0) {
				const tagNames = post.tags.map(tag => `#${tag.name}`).join(" ");
				mainEmbed.addFields({
					name: "🏷️ 標籤",
					value: tagNames,
					inline: false
				});
			}

			// 添加圖片
			if (imageUrls.length > 0 && imageUrls[0]) {
				mainEmbed.setImage(imageUrls[0]);
			}

			embeds.push(mainEmbed);

			// 為剩餘的圖片建立額外的 embed
			for (let i = 1; i < imageUrls.length && i < maxImages; i++) {
				const imageUrl = imageUrls[i];
				if (imageUrl) {
					const imageEmbed = new EmbedBuilder()
						.setURL(postUrl)
						.setImage(imageUrl);

					embeds.push(imageEmbed);
				}
			}

			// 嘗試編輯訊息
			await originalMessage.edit({ embeds });
			logger.info(`成功編輯訊息 ${sentMessage.messageId}`);
			return true;
		} catch (error) {
			logger.error(`編輯訊息失敗 ${sentMessage.messageId}`, { error });
			return false;
		}
	}
}

// 單例模式
const nikkeNotificationService = new NikkeNotificationService();

export default nikkeNotificationService;
