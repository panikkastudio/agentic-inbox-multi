// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { sendEmail, describeSendError } from "../email-sender";
import { storeAttachments } from "../lib/attachments";
import type { EmailFull } from "../lib/schemas";
import {
	validateSender,
	SenderValidationError,
	buildReferencesChain,
	buildThreadingHeaders,
	buildSentRawHeaders,
	resolveOriginalEmail,
} from "../lib/email-helpers";
import { SendEmailRequestSchema } from "../lib/schemas";
import { Folders } from "../../shared/folders";
import type { MailboxContext } from "../lib/mailbox";
import { getMailboxPolicy } from "../lib/mailbox-policy";

type AppContext = Context<MailboxContext>;
type RateLimitStub = { checkSendRateLimit: () => Promise<string | null> };

export async function handleReplyEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const id = c.req.param("id") ?? "";
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments } = body;

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	const { originalMsgId, references, threadId: thread_id } = buildReferencesChain(originalEmail);

	let toStr: string, fromEmail: string;
	try {
		({ toStr, fromEmail } = validateSender(
			to,
			from,
			mailboxId,
			getMailboxPolicy(c.env.DOMAINS, c.env.EMAIL_ADDRESSES),
		));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const rateLimitError = await (stub as unknown as RateLimitStub)
		.checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	// Send first; only file under Sent once Email Service accepted it, and
	// store the Message-ID it assigned so the recipient's reply threads back.
	let sentMessageId: string;
	try {
		({ messageId: sentMessageId } = await sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition,
				contentId: att.contentId,
			})),
			headers: buildThreadingHeaders(originalMsgId, references),
		}));
	} catch (e) {
		console.error("Reply delivery failed:", describeSendError(e));
		return c.json({ error: `Reply was not sent: ${describeSendError(e)}` }, 502);
	}

	const messageId = crypto.randomUUID();
	const date = new Date().toISOString();
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date,
			body: html || text || "",
			in_reply_to: originalMsgId,
			email_references: JSON.stringify(references),
			thread_id: thread_id,
			message_id: sentMessageId,
			raw_headers: buildSentRawHeaders({
				from, to, cc, bcc, subject, date,
				messageId: sentMessageId,
				inReplyTo: originalMsgId,
				references,
			}),
		},
		attachmentData,
	);

	await stub.markThreadRead(thread_id);

	return c.json({ id: messageId, status: "sent", message_id: sentMessageId }, 202);
}

export async function handleForwardEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const id = c.req.param("id") ?? "";
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments } = body;

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	await resolveOriginalEmail(stub, rawOriginal);

	let toStr: string, fromEmail: string;
	try {
		({ toStr, fromEmail } = validateSender(
			to,
			from,
			mailboxId,
			getMailboxPolicy(c.env.DOMAINS, c.env.EMAIL_ADDRESSES),
		));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const rateLimitError = await (stub as unknown as RateLimitStub)
		.checkSendRateLimit();
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	let sentMessageId: string;
	try {
		({ messageId: sentMessageId } = await sendEmail(c.env.EMAIL, {
			to,
			cc,
			bcc,
			from,
			subject,
			html,
			text,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition,
				contentId: att.contentId,
			})),
		}));
	} catch (e) {
		console.error("Forward delivery failed:", describeSendError(e));
		return c.json({ error: `Forward was not sent: ${describeSendError(e)}` }, 502);
	}

	const messageId = crypto.randomUUID();
	const date = new Date().toISOString();
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(
		Folders.SENT,
		{
			id: messageId,
			subject,
			sender: fromEmail,
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date,
			body: html || text || "",
			in_reply_to: null,
			email_references: null,
			thread_id: messageId,
			message_id: sentMessageId,
			raw_headers: buildSentRawHeaders({ from, to, cc, bcc, subject, date, messageId: sentMessageId }),
		},
		attachmentData,
	);

	return c.json({ id: messageId, status: "sent", message_id: sentMessageId }, 202);
}
