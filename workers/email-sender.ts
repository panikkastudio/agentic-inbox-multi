// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via Cloudflare Email Service binding.
 *
 * Uses the `send_email` Worker binding (`env.EMAIL.send()`) to send emails.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 *
 * Message-ID is platform-controlled: Email Service rejects it in `headers`
 * (and silently replaces it in raw MIME). The id Cloudflare assigns is the
 * one recipients see, and `send()` returns it, so callers must store the
 * returned `messageId` to keep threading intact. In-Reply-To and References
 * are allowed and must be passed on replies.
 * See: https://developers.cloudflare.com/email-service/reference/headers/
 */

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	/** Allowlisted headers only (e.g. In-Reply-To, References, X-*). Never Message-ID. */
	headers?: Record<string, string>;
}

/** Strip surrounding angle brackets and whitespace from a Message-ID. */
export function normalizeMessageId(value: string): string {
	return value.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
}

/** A user-facing description of a failed send, including the Email Service error code. */
export function describeSendError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && code && !message.includes(code)
		? `${message} (${code})`
		: message;
}

/**
 * Send an email using the Cloudflare Email Service binding.
 *
 * @param binding  - The `EMAIL` SendEmail binding from env
 * @param params   - Email parameters (to, from, subject, body, etc.)
 * @returns The Message-ID Cloudflare assigned, without angle brackets
 * @throws On validation or delivery errors (error has `.code` property)
 */
export async function sendEmail(
	binding: SendEmail,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const message: Record<string, unknown> = {
		to: params.to,
		from: params.from,
		subject: params.subject,
	};

	if (params.html) message.html = params.html;
	if (params.text) message.text = params.text;
	if (params.cc) message.cc = params.cc;
	if (params.bcc) message.bcc = params.bcc;
	if (params.replyTo) message.replyTo = params.replyTo;

	if (params.headers && Object.keys(params.headers).length > 0) {
		message.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		message.attachments = params.attachments.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			...(att.contentId ? { contentId: att.contentId } : {}),
		}));
	}

	const result = await binding.send(message as any);
	const messageId = result?.messageId ? normalizeMessageId(result.messageId) : "";
	if (!messageId) throw new Error("Email Service did not return a Message-ID");
	return { messageId };
}
