import { EmbedBuilder, EmbedField } from "discord.js";

// Discord Embed 限制常量
export const EMBED_LIMITS = {
	DESCRIPTION_MAX: 4096,
	FIELD_NAME_MAX: 256,
	FIELD_VALUE_MAX: 1024,
	MAX_FIELDS: 25,
	TITLE_MAX: 256,
	FOOTER_MAX: 2048
} as const;

/**
 * 安全地截斷文本，確保不超過指定長度
 * @param text - 要截斷的文本
 * @param maxLength - 最大長度
 * @param suffix - 截斷後綴，默認為 "..."
 * @returns 截斷後的文本
 */
export function safeTruncate(
	text: string,
	maxLength: number,
	suffix: string = "..."
): string {
	if (text.length <= maxLength) return text;

	const truncatedLength = maxLength - suffix.length;
	if (truncatedLength <= 0) return suffix;

	return text.slice(0, truncatedLength) + suffix;
}

/**
 * 分割長文本為多個字段
 * @param name - 字段名稱
 * @param value - 字段值
 * @param maxValueLength - 每個字段值的最大長度
 * @returns 分割後的字段數組
 */
export function splitField(
	name: string,
	value: string,
	maxValueLength: number = EMBED_LIMITS.FIELD_VALUE_MAX
): EmbedField[] {
	const fields: EmbedField[] = [];

	if (value.length <= maxValueLength) {
		fields.push({
			name: safeTruncate(name, EMBED_LIMITS.FIELD_NAME_MAX),
			value: value,
			inline: false
		});
		return fields;
	}

	// 按行分割
	const lines = value.split("\n");
	let currentField = "";
	let fieldIndex = 1;

	for (const line of lines) {
		// 如果當前行加上換行符會超過限制
		if (currentField.length + line.length + 1 > maxValueLength) {
			if (currentField) {
				fields.push({
					name:
						fieldIndex === 1
							? safeTruncate(name, EMBED_LIMITS.FIELD_NAME_MAX)
							: `${name} (續 ${fieldIndex})`,
					value: currentField,
					inline: false
				});
				fieldIndex++;
				currentField = line;
			} else {
				// 單行就超過限制，需要截斷
				fields.push({
					name:
						fieldIndex === 1
							? safeTruncate(name, EMBED_LIMITS.FIELD_NAME_MAX)
							: `${name} (續 ${fieldIndex})`,
					value: safeTruncate(line, maxValueLength),
					inline: false
				});
				fieldIndex++;
			}
		} else {
			currentField += (currentField ? "\n" : "") + line;
		}
	}

	// 添加最後一個字段
	if (currentField) {
		fields.push({
			name:
				fieldIndex === 1
					? safeTruncate(name, EMBED_LIMITS.FIELD_NAME_MAX)
					: `${name} (續 ${fieldIndex})`,
			value: currentField,
			inline: false
		});
	}

	return fields;
}

/**
 * 創建安全的 Embed，自動處理所有限制
 * @param options - Embed 選項
 * @returns 安全的 EmbedBuilder
 */
export function createSafeEmbed(options: {
	title?: string;
	description?: string;
	color?: string | number;
	fields?: EmbedField[];
	footer?: string;
	timestamp?: Date | number;
	thumbnail?: string;
	image?: string;
}): EmbedBuilder {
	const embed = new EmbedBuilder();

	// 設置標題
	if (options.title) {
		embed.setTitle(safeTruncate(options.title, EMBED_LIMITS.TITLE_MAX));
	}

	// 設置描述
	if (options.description) {
		embed.setDescription(
			safeTruncate(options.description, EMBED_LIMITS.DESCRIPTION_MAX)
		);
	}

	// 設置顏色
	if (options.color) {
		embed.setColor(options.color as any);
	}

	// 設置縮略圖
	if (options.thumbnail) {
		embed.setThumbnail(options.thumbnail);
	}

	// 設置圖片
	if (options.image) {
		embed.setImage(options.image);
	}

	// 設置時間戳
	if (options.timestamp) {
		embed.setTimestamp(options.timestamp);
	}

	// 處理字段
	if (options.fields && options.fields.length > 0) {
		const safeFields: EmbedField[] = [];

		for (const field of options.fields) {
			// 如果字段值太長，分割它
			if (field.value.length > EMBED_LIMITS.FIELD_VALUE_MAX) {
				const splitFields = splitField(
					field.name,
					field.value,
					EMBED_LIMITS.FIELD_VALUE_MAX
				);
				safeFields.push(...splitFields);
			} else {
				safeFields.push({
					name: safeTruncate(field.name, EMBED_LIMITS.FIELD_NAME_MAX),
					value: field.value,
					inline: field.inline || false
				});
			}

			// 檢查字段數量限制
			if (safeFields.length >= EMBED_LIMITS.MAX_FIELDS) {
				break;
			}
		}

		embed.addFields(safeFields);
	}

	// 設置頁腳
	if (options.footer) {
		embed.setFooter({
			text: safeTruncate(options.footer, EMBED_LIMITS.FOOTER_MAX)
		});
	}

	return embed;
}

/**
 * 檢查 Embed 是否超過限制
 * @param embed - 要檢查的 Embed
 * @returns 檢查結果
 */
export function validateEmbed(embed: EmbedBuilder): {
	isValid: boolean;
	issues: string[];
} {
	const issues: string[] = [];
	const data = embed.data;

	// 檢查標題長度
	if (data.title && data.title.length > EMBED_LIMITS.TITLE_MAX) {
		issues.push(`標題長度超過 ${EMBED_LIMITS.TITLE_MAX} 字符`);
	}

	// 檢查描述長度
	if (
		data.description &&
		data.description.length > EMBED_LIMITS.DESCRIPTION_MAX
	) {
		issues.push(`描述長度超過 ${EMBED_LIMITS.DESCRIPTION_MAX} 字符`);
	}

	// 檢查字段數量
	if (data.fields && data.fields.length > EMBED_LIMITS.MAX_FIELDS) {
		issues.push(`字段數量超過 ${EMBED_LIMITS.MAX_FIELDS} 個`);
	}

	// 檢查字段長度
	if (data.fields) {
		data.fields.forEach((field, index) => {
			if (field.name.length > EMBED_LIMITS.FIELD_NAME_MAX) {
				issues.push(
					`字段 ${index + 1} 名稱長度超過 ${EMBED_LIMITS.FIELD_NAME_MAX} 字符`
				);
			}
			if (field.value.length > EMBED_LIMITS.FIELD_VALUE_MAX) {
				issues.push(
					`字段 ${index + 1} 值長度超過 ${EMBED_LIMITS.FIELD_VALUE_MAX} 字符`
				);
			}
		});
	}

	// 檢查頁腳長度
	if (
		data.footer?.text &&
		data.footer.text.length > EMBED_LIMITS.FOOTER_MAX
	) {
		issues.push(`頁腳長度超過 ${EMBED_LIMITS.FOOTER_MAX} 字符`);
	}

	return {
		isValid: issues.length === 0,
		issues
	};
}
