import { Logger } from "./logger.js";
import databaseService from "./database.js";
import { getNotificationSettings } from "../commands/notification.js";
import {
	Client,
	TextChannel,
	ContainerBuilder,
	SectionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	SeparatorBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	Message
} from "discord.js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const logger = new Logger("NIKKE通知服務");

interface SentMessage {
	messageId: string;
	postUuid: string;
	channelId: string;
	guildId: string;
	sentAt: number;
	lastModified: string;
}

interface BlablaPost {
	post_uuid: string;
	title: string;
	content: string;
	pic_urls: string[];
	modified_on: string;
	created_on: string;
	browse_count: string;
	upvote_count: string;
	comment_count: string;
	tags: Array<{ id: string; name: string }>;
	user: {
		username: string;
		avatar: string;
	};
	[key: string]: any;
}

interface ApiResponse {
	code: number;
	msg: string;
	data: {
		list: BlablaPost[];
	};
}

class NikkeNotificationService {
	private client: Client | null = null;
	private intervalId: NodeJS.Timeout | null = null;
	private isRunning = false;
	private readonly API_URL =
		"https://api.blablalink.com/api/ugc/direct/standalonesite/Dynamics/GetPostList";
	private readonly CHECK_INTERVAL = 10 * 60 * 1000;

	constructor() {
		logger.info("NIKKE 通知服務初始化");
	}

	public initialize(client: Client): void {
		this.client = client;
		logger.info("NIKKE 通知服務已連接到 Discord 客戶端");
	}

	public start(): void {
		if (this.isRunning) return;
		if (!this.client) return;

		this.isRunning = true;
		this.checkForNewPosts().catch(e =>
			logger.error("初始檢查失敗", { error: e })
		);
		this.intervalId = setInterval(() => {
			this.checkForNewPosts().catch(e =>
				logger.error("定期檢查失敗", { error: e })
			);
		}, this.CHECK_INTERVAL);
	}

	public stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.isRunning = false;
	}

	private async checkForNewPosts(): Promise<void> {
		try {
			const posts = await this.fetchLatestPosts();
			if (!posts || posts.length === 0) return;

			const guilds = await this.getAllNotificationGuilds();
			if (guilds.length === 0) return;

			for (const guildId of guilds) {
				await this.checkGuildForNewPosts(guildId, posts);
			}
		} catch (error) {
			logger.error("檢查新貼文時發生錯誤", { error });
		}
	}

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

			if (!response.ok) return null;
			const data = (await response.json()) as ApiResponse;
			if (data.code !== 0 || !data.data?.list) return null;
			return data.data.list;
		} catch (e) {
			return null;
		}
	}

	private async getAllNotificationGuilds(): Promise<string[]> {
		try {
			const db = databaseService.getDB();
			if (!db) return [];
			const allData = await db.all();
			return allData
				.filter(
					(item: any) =>
						item.id.startsWith("notification_") &&
						item.value?.enabled
				)
				.map((item: any) => item.id.replace("notification_", ""));
		} catch (e) {
			return [];
		}
	}

	private async checkGuildForNewPosts(
		guildId: string,
		posts: BlablaPost[]
	): Promise<void> {
		const settings = await getNotificationSettings(guildId);
		if (!settings || !settings.enabled) return;

		const latestPost = posts[0];
		if (!latestPost) return;

		const sentMessage = await this.getSentMessage(
			guildId,
			latestPost.post_uuid
		);

		if (!sentMessage) {
			const messageId = await this.sendNotification(
				guildId,
				settings.channelId,
				latestPost
			);
			if (messageId) {
				await this.saveSentMessage({
					messageId,
					postUuid: latestPost.post_uuid,
					channelId: settings.channelId,
					guildId,
					sentAt: Date.now(),
					lastModified: latestPost.modified_on
				});
				await this.updateLastPostId(guildId, latestPost.post_uuid);
			}
		} else if (sentMessage.lastModified !== latestPost.modified_on) {
			const success = await this.updateSentMessage(
				sentMessage,
				latestPost
			);
			if (success) {
				sentMessage.lastModified = latestPost.modified_on;
				await this.saveSentMessage(sentMessage);
			} else {
				const messageId = await this.sendNotification(
					guildId,
					settings.channelId,
					latestPost
				);
				if (messageId) {
					sentMessage.messageId = messageId;
					sentMessage.lastModified = latestPost.modified_on;
					await this.saveSentMessage(sentMessage);
				}
			}
		}
	}

	private async sendNotification(
		guildId: string,
		channelId: string,
		post: BlablaPost,
		isEdit: boolean = false
	): Promise<string | null> {
		try {
			if (!this.client) return null;
			const channel = (await this.client.channels.fetch(
				channelId
			)) as TextChannel;
			if (!channel) return null;

			const payload = this.buildPayload(post, isEdit);
			const message = await channel.send(payload);
			return message.id;
		} catch (e) {
			logger.error(`發送通知失敗 ${guildId}`, { error: e });
			return null;
		}
	}

	private async updateSentMessage(
		sentMessage: SentMessage,
		post: BlablaPost
	): Promise<boolean> {
		try {
			if (!this.client) return false;
			const channel = (await this.client.channels.fetch(
				sentMessage.channelId
			)) as TextChannel;
			if (!channel) return false;

			const message = await channel.messages
				.fetch(sentMessage.messageId)
				.catch(() => null);
			if (!message) return false;

			const payload = this.buildPayload(post, true);
			await message.edit(payload);
			return true;
		} catch (e) {
			return false;
		}
	}

	private buildPayload(post: BlablaPost, isEdit: boolean): any {
		const container = new ContainerBuilder();
		const postUrl = `https://www.blablalink.com/post/detail?post_uuid=${post.post_uuid}`;
		const date = `<t:${post.created_on}:f>`;

		const $title = cheerio.load(post.title || "");
		const decodedTitle = $title.text();
		const titlePrefix = isEdit ? "📝 [已編輯] " : "";

		const headerContent = `### [${titlePrefix}${decodedTitle}](${postUrl})\n-# ${post.user.username} • ${date}`;
		const textDisplayHelper = new TextDisplayBuilder().setContent(
			headerContent
		);

		if (post.user.avatar) {
			const headerSection = new SectionBuilder()
				.addTextDisplayComponents(textDisplayHelper)
				.setThumbnailAccessory(
					new ThumbnailBuilder({ media: { url: post.user.avatar } })
				);
			container.addSectionComponents(headerSection);
		} else {
			container.addTextDisplayComponents(textDisplayHelper);
		}

		container.addSeparatorComponents(
			new SeparatorBuilder().setDivider(true).setSpacing(2)
		);

		const elements = this.parseContent(post.content);

		let currentLength = 0;
		const MAX_LENGTH = 3900;
		let isTruncated = false;
		let textBuffer = "";
		let imageBuffer: string[] = [];

		const flushText = () => {
			if (textBuffer.trim()) {
				if (currentLength >= MAX_LENGTH) {
					textBuffer = "";
					return;
				}

				let toAdd = textBuffer;
				if (currentLength + toAdd.length > MAX_LENGTH) {
					toAdd = toAdd.substring(0, MAX_LENGTH - currentLength);
					isTruncated = true;
				}

				if (toAdd.trim()) {
					container.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(toAdd)
					);
					currentLength += toAdd.length;
				}
				textBuffer = "";
			}
		};

		const flushImages = () => {
			if (imageBuffer.length > 0) {
				while (imageBuffer.length > 0) {
					if (isTruncated) break;
					const batch = imageBuffer.splice(0, 4);
					const mediaGallery = new MediaGalleryBuilder();
					batch.forEach(url =>
						mediaGallery.addItems(
							new MediaGalleryItemBuilder({ media: { url } })
						)
					);
					container.addMediaGalleryComponents(mediaGallery);
				}
				imageBuffer = [];
			}
		};

		for (const el of elements) {
			if (isTruncated || currentLength >= MAX_LENGTH) {
				isTruncated = true;
				break;
			}

			if (el.type === "text") {
				flushImages();
				textBuffer += el.content;
			} else if (el.type === "image") {
				flushText();
				if (isTruncated) break;
				imageBuffer.push(el.content);
			}
		}
		flushText();
		flushImages();

		if (isTruncated) {
			const footer = `\n... [閱讀全文](${postUrl})`;
			if (MAX_LENGTH - currentLength >= footer.length) {
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(footer)
				);
			}
		}

		if (post.tags && post.tags.length > 0 && !isTruncated) {
			const tags = post.tags.map(t => `#${t.name}`).join(" ");
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`\n${tags}`)
			);
		}

		return {
			content: "",
			flags: MessageFlags.IsComponentsV2,
			components: [container]
		};
	}

	private parseContent(
		html: string
	): Array<{ type: "text" | "image"; content: string }> {
		const $ = cheerio.load(html);
		const elements: Array<{ type: "text" | "image"; content: string }> = [];

		const flatten = (node: any) => {
			if (node.type === "text") {
				const text = node.data;
				if (text) elements.push({ type: "text", content: text });
			} else if (node.type === "tag") {
				const tagName = node.name;
				if (tagName === "img") {
					const src = node.attribs.src;
					if (src && !src.startsWith("data:"))
						elements.push({ type: "image", content: src });
					return;
				}
				if (tagName === "br") {
					elements.push({ type: "text", content: "\n" });
					return;
				}

				let prefix = "",
					suffix = "";
				if (["b", "strong"].includes(tagName)) {
					prefix = "**";
					suffix = "**";
				} else if (["i", "em"].includes(tagName)) {
					prefix = "*";
					suffix = "*";
				} else if (tagName === "p") suffix = "\n\n";

				if (prefix) elements.push({ type: "text", content: prefix });
				node.children.forEach((c: any) => flatten(c));
				if (suffix) elements.push({ type: "text", content: suffix });
			}
		};

		$("body")
			.contents()
			.each((i, el) => flatten(el));

		const merged: any[] = [];
		let buf = "";
		for (const el of elements) {
			if (el.type === "text") {
				buf += el.content;
			} else {
				if (buf) {
					merged.push({ type: "text", content: buf });
					buf = "";
				}
				merged.push(el);
			}
		}
		if (buf) merged.push({ type: "text", content: buf });

		return merged
			.map(item => {
				if (item.type === "text") {
					let t = item.content
						.replace(/&nbsp;/g, " ")
						.replace(/\n{3,}/g, "\n\n")
						.trim();
					// Nikke formatting issues - some posts might be all images with minimal text
					// Retain text if it has substance
					if (!t) return null;
					return { ...item, content: t };
				}
				return item;
			})
			.filter(Boolean);
	}

	private async getSentMessage(
		guildId: string,
		postUuid: string
	): Promise<SentMessage | null> {
		const db = databaseService.getDB();
		if (!db) return null;
		const res = await db.get(`sent_message_${guildId}_${postUuid}`);
		return (res as SentMessage) || null;
	}
	private async saveSentMessage(msg: SentMessage): Promise<void> {
		const db = databaseService.getDB();
		if (db)
			await db.set(`sent_message_${msg.guildId}_${msg.postUuid}`, msg);
	}
	private async updateLastPostId(
		guildId: string,
		postId: string
	): Promise<void> {
		const settings = await getNotificationSettings(guildId);
		if (settings) {
			settings.lastPostId = postId;
			settings.updatedAt = Date.now();
			const db = databaseService.getDB();
			if (db) await db.set(`notification_${guildId}`, settings);
		}
	}
}

const nikkeNotificationService = new NikkeNotificationService();
export default nikkeNotificationService;
