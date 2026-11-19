// Notify an external webhook (e.g. a T3 Code webhook task) when a mailbox
// receives an email. Configured with the MAILBOX_WEBHOOKS secret, a JSON map
// of mailbox address → webhook URL.

const MAX_TEXT_LENGTH = 20_000;

export interface MailboxWebhookPayload {
	event: "email.received";
	mailboxId: string;
	emailId: string;
	emailThreadId: string;
	t3ThreadId: string | null;
	isReply: boolean;
	from: string;
	fromName: string | null;
	to: string;
	cc: string | null;
	subject: string;
	text: string;
	receivedAt: string;
}

export function findMailboxWebhookUrl(config: string | undefined, mailboxId: string): string | null {
	if (!config) return null;
	try {
		const map = JSON.parse(config) as Record<string, unknown>;
		for (const [address, url] of Object.entries(map)) {
			if (address.trim().toLowerCase() === mailboxId && typeof url === "string") return url;
		}
	} catch (e) {
		console.error("MAILBOX_WEBHOOKS is not valid JSON:", (e as Error).message);
	}
	return null;
}

export function emailBodyAsText(text: string | undefined, html: string | undefined): string {
	const body = text?.trim() || htmlToText(html || "");
	return body.length > MAX_TEXT_LENGTH ? `${body.slice(0, MAX_TEXT_LENGTH)}\n…[truncated]` : body;
}

function htmlToText(html: string): string {
	return html
		.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
		.replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export async function postMailboxWebhook(url: string, payload: MailboxWebhookPayload): Promise<void> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!response.ok) {
			console.error(`Mailbox webhook for ${payload.mailboxId} failed: HTTP ${response.status}`);
		}
	} catch (e) {
		console.error(`Mailbox webhook for ${payload.mailboxId} failed:`, (e as Error).message);
	}
}
