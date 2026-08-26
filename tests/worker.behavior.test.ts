import { env } from "cloudflare:workers";
import type { ForwardableEmailMessage } from "@cloudflare/workers-types";
import worker from "../workers/app";
import type { Env } from "../workers/types";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const mailboxAddress = "hello@example.com";
const workerEnv = env as Env;

type TestEnv = Env & {
	DOMAINS: string;
	EMAIL_ADDRESSES: string[];
};

async function request(
	path: string,
	init?: RequestInit,
	requestEnv: Env = workerEnv,
	context: ExecutionContext = createExecutionContext(),
) {
	return worker.fetch(
		new Request(`https://worker.test${path}`, init),
		requestEnv,
		context,
	);
}

async function createMailbox(
	email = mailboxAddress,
	name = "Hello",
	requestEnv: Env = workerEnv,
) {
	const response = await request("/api/v1/mailboxes", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, name }),
	}, requestEnv);

	expect(response.status).toBe(201);
}

function cloudflareEmailEvent(
	rawMessage: string,
	envelopeRecipient = mailboxAddress,
): ForwardableEmailMessage {
	const from = "sender@external.test";
	const headerRecipient = mailboxAddress;
	const raw = new TextEncoder().encode(rawMessage);

	return {
		from,
		to: envelopeRecipient,
		headers: new Headers({
			From: from,
			To: headerRecipient,
			Subject: "Welcome",
			"Message-ID": "<welcome-1@external.test>",
			"Content-Type": "text/plain; charset=utf-8",
		}),
		raw: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(raw);
				controller.close();
			},
		}),
		rawSize: raw.byteLength,
		setReject(_reason: string) {},
		forward: async (_rcptTo: string, _headers?: Headers) => ({
			messageId: "test-forward-message-id",
		}),
		reply: async (_message: { from: string; to: string }) => ({
			messageId: "test-reply-message-id",
		}),
	};
}

describe("Worker behavior", () => {
	afterEach(async () => {
		await reset();
	});

	it("creates and reads a mailbox through the HTTP entrypoint", async () => {
		await createMailbox();

		const response = await request(`/api/v1/mailboxes/${mailboxAddress}`);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: mailboxAddress,
			email: mailboxAddress,
			name: "hello@example.com",
			settings: { fromName: "Hello" },
		});
	});

	it("normalizes configured domains in the public configuration", async () => {
		const response = await request("/api/v1/config");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			domains: ["example.com", "second.test"],
			emailAddresses: [],
		});
	});

	it("creates independent mailboxes for the same local part on two domains", async () => {
		await createMailbox("hello@example.com", "Example Hello");
		await createMailbox("hello@second.test", "Second Hello");

		const exampleResponse = await request("/api/v1/mailboxes/hello@example.com");
		const secondResponse = await request("/api/v1/mailboxes/hello@second.test");

		expect(await exampleResponse.json()).toMatchObject({
			id: "hello@example.com",
			settings: { fromName: "Example Hello" },
		});
		expect(await secondResponse.json()).toMatchObject({
			id: "hello@second.test",
			settings: { fromName: "Second Hello" },
		});
	});

	it("rejects mailbox creation outside configured domains without creating state", async () => {
		const response = await request("/api/v1/mailboxes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "hello@unauthorized.test", name: "Nope" }),
		});

		expect(response.status).toBe(403);
		const listResponse = await request("/api/v1/mailboxes");
		expect(await listResponse.json()).toEqual([]);
	});

	it("keeps single-domain mailbox creation behavior", async () => {
		const singleDomainEnv = {
			...workerEnv,
			DOMAINS: "example.com",
			EMAIL_ADDRESSES: [],
		} as TestEnv;

		await createMailbox("hello@example.com", "Hello", singleDomainEnv);
		const rejected = await request("/api/v1/mailboxes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "hello@second.test", name: "Nope" }),
		}, singleDomainEnv);

		expect(rejected.status).toBe(403);
	});

	it("fails closed when no mailbox domains are configured", async () => {
		const noDomainEnv = {
			...workerEnv,
			DOMAINS: "",
			EMAIL_ADDRESSES: [],
		} as TestEnv;

		const response = await request("/api/v1/mailboxes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: mailboxAddress, name: "Nope" }),
		}, noDomainEnv);

		expect(response.status).toBe(403);
	});

	it("uses exact addresses as a stricter multi-domain allowlist", async () => {
		const exactEnv = {
			...workerEnv,
			DOMAINS: "first.test, second.test",
			EMAIL_ADDRESSES: [" One@first.test. ", "two@second.test"],
		} as TestEnv;

		await createMailbox("one@first.test", "One", exactEnv);
		await createMailbox("two@second.test", "Two", exactEnv);
		const rejected = await request("/api/v1/mailboxes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "three@second.test", name: "Three" }),
		}, exactEnv);

		expect(rejected.status).toBe(403);
		const config = await request("/api/v1/config", undefined, exactEnv);
		expect(await config.json()).toEqual({
			domains: ["first.test", "second.test"],
			emailAddresses: ["one@first.test", "two@second.test"],
		});
	});

	it("does not allow sending from another mailbox address", async () => {
		await createMailbox("hello@example.com", "Hello");
		await createMailbox("hello@second.test", "Second");

		const response = await request("/api/v1/mailboxes/hello@example.com/emails", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				to: "recipient@external.test",
				from: "hello@second.test",
				subject: "Rejected sender",
				text: "This must not be sent",
			}),
		});

		expect(response.status).toBe(400);
	});

	it("sends through Email Service with the selected mailbox domain", async () => {
		const sentMessages: Array<{ from: string; headers?: Record<string, string> }> = [];
		const emailEnv = {
			...workerEnv,
			EMAIL: {
				send: async (message: { from: string; headers?: Record<string, string> }) => {
					sentMessages.push(message);
					return { messageId: "test-outbound-message-id" };
				},
			},
		} as unknown as TestEnv;
		await createMailbox("hello@example.com", "Hello", emailEnv);
		await createMailbox("hello@second.test", "Second", emailEnv);

		const sendFrom = async (mailbox: string) => {
			const context = createExecutionContext();
			const response = await worker.fetch(
				new Request(`https://worker.test/api/v1/mailboxes/${mailbox}/emails`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						to: "recipient@external.test",
						from: mailbox,
						subject: `Sent from ${mailbox}`,
						text: "Outbound test",
					}),
				}),
				emailEnv,
				context,
			);

			expect(response.status).toBe(202);
			await waitOnExecutionContext(context);
		};

		await sendFrom("hello@example.com");
		await sendFrom("hello@second.test");
		expect(sentMessages).toHaveLength(2);
		expect(sentMessages.map(({ from }) => from)).toEqual([
			"hello@example.com",
			"hello@second.test",
		]);
		expect(sentMessages.map(({ headers }) => headers?.["Message-ID"])).toEqual([
			expect.stringMatching(/@example\.com>$/),
			expect.stringMatching(/@second\.test>$/),
		]);
	});

	it("delivers an email to an existing mailbox through the email entrypoint", async () => {
		await createMailbox();

		const context = createExecutionContext();
		await worker.email(
			cloudflareEmailEvent(
				"From: sender@external.test\r\n" +
					"To: hello@example.com\r\n" +
					"Subject: Welcome\r\n" +
					"Message-ID: <welcome-1@external.test>\r\n" +
					"Content-Type: text/plain; charset=utf-8\r\n" +
					"\r\n" +
					"Hello\r\n",
			),
			workerEnv,
			context,
		);

		const response = await request(
			`/api/v1/mailboxes/${mailboxAddress}/emails?folder=inbox`,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			totalCount: 1,
			emails: [
				{
					subject: "Welcome",
					sender: "sender@external.test",
					recipient: mailboxAddress,
					snippet: "Hello\n",
				},
			],
		});
		await waitOnExecutionContext(context);
	});

	it("routes mismatched MIME recipients to the normalized envelope mailbox", async () => {
		const secondMailbox = "hello@second.test";
		await createMailbox(mailboxAddress, "Example Hello");
		await createMailbox(secondMailbox, "Second Hello");

		const context = createExecutionContext();
		await worker.email(
			cloudflareEmailEvent(
				"From: sender@external.test\r\n" +
					"To: first@example.com\r\n" +
					"Cc: copy@example.com\r\n" +
					"Bcc: blind@example.com\r\n" +
					"Subject: Envelope recipient\r\n" +
					"Message-ID: <envelope-1@external.test>\r\n" +
					"Content-Type: text/plain; charset=utf-8\r\n" +
					"\r\n" +
					"Hello\r\n",
				"HELLO@SECOND.TEST.",
			),
			workerEnv,
			context,
		);
		await waitOnExecutionContext(context);

		const secondResponse = await request(
			`/api/v1/mailboxes/${secondMailbox}/emails?folder=inbox`,
		);
		const secondInbox = await secondResponse.json() as { emails: Array<Record<string, string>>; totalCount: number };
		expect(secondInbox.totalCount).toBe(1);
		expect(secondInbox.emails[0]).toMatchObject({
			recipient: "first@example.com",
			cc: "copy@example.com",
			bcc: "blind@example.com",
		});
		const detailResponse = await request(
			`/api/v1/mailboxes/${secondMailbox}/emails/${secondInbox.emails[0].id}`,
		);
		const detail = await detailResponse.json() as { raw_headers: string };
		const rawHeaders = JSON.parse(detail.raw_headers) as Array<{ key: string; value: string }>;
		expect(rawHeaders).toEqual(expect.arrayContaining([
			{ key: "to", value: "first@example.com" },
			{ key: "cc", value: "copy@example.com" },
			{ key: "bcc", value: "blind@example.com" },
		]));

		const firstResponse = await request(
			`/api/v1/mailboxes/${mailboxAddress}/emails?folder=inbox`,
		);
		expect(await firstResponse.json()).toMatchObject({ totalCount: 0 });
	});

	it("keeps same-local-part sent attachments isolated by domain", async () => {
		const firstMailbox = "hello@example.com";
		const secondMailbox = "hello@second.test";
		const emailEnv = {
			...workerEnv,
			EMAIL: { send: async () => ({ messageId: "test-outbound-message-id" }) },
		} as unknown as TestEnv;
		await createMailbox(firstMailbox, "Example Hello", emailEnv);
		await createMailbox(secondMailbox, "Second Hello", emailEnv);

		for (const mailbox of [firstMailbox, secondMailbox]) {
			const context = createExecutionContext();
			const response = await request(`/api/v1/mailboxes/${mailbox}/emails`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					to: "recipient@external.test",
					from: mailbox,
					subject: `Sent from ${mailbox}`,
					text: "Hello",
					attachments: [{
						content: "SGVsbG8=",
						filename: "note.txt",
						type: "text/plain",
						disposition: "attachment",
					}],
				}),
			}, emailEnv, context);
			expect(response.status).toBe(202);
			await waitOnExecutionContext(context);

			const sentResponse = await request(
				`/api/v1/mailboxes/${mailbox}/emails?folder=sent`,
				undefined,
				emailEnv,
			);
			const sent = await sentResponse.json() as { emails: Array<{ id: string }>; totalCount: number };
			expect(sent.totalCount).toBe(1);
			const detailResponse = await request(
				`/api/v1/mailboxes/${mailbox}/emails/${sent.emails[0].id}`,
				undefined,
				emailEnv,
			);
			expect(await detailResponse.json()).toMatchObject({
				attachments: [{ filename: "note.txt" }],
			});
		}
	});

	it("delivers BCC mail without a MIME To recipient", async () => {
		const secondMailbox = "hello@second.test";
		await createMailbox(secondMailbox, "Second Hello");

		const context = createExecutionContext();
		await worker.email(
			cloudflareEmailEvent(
				"From: sender@external.test\r\n" +
					"Subject: Blind delivery\r\n" +
					"Bcc: blind@example.com\r\n" +
					"Content-Type: text/plain; charset=utf-8\r\n" +
					"\r\n" +
					"Secret hello\r\n",
				secondMailbox,
			),
			workerEnv,
			context,
		);
		await waitOnExecutionContext(context);

		const response = await request(
			`/api/v1/mailboxes/${secondMailbox}/emails?folder=inbox`,
		);
		expect(await response.json()).toMatchObject({
			totalCount: 1,
			emails: [{ recipient: "", bcc: "blind@example.com" }],
		});
	});

	it("ignores unauthorized envelope mail without parsing or creating state", async () => {
		const exactEnv = {
			...workerEnv,
			DOMAINS: "example.com",
			EMAIL_ADDRESSES: ["allowed@example.com"],
		} as TestEnv;
		const context = createExecutionContext();

		await worker.email(
			cloudflareEmailEvent("not a MIME message", "other@example.com"),
			exactEnv,
			context,
		);
		await waitOnExecutionContext(context);

		const response = await request("/api/v1/mailboxes", undefined, exactEnv);
		expect(await response.json()).toEqual([]);
	});

	it("ignores configured-domain mail when its mailbox does not exist", async () => {
		const context = createExecutionContext();

		await worker.email(
			cloudflareEmailEvent("not a MIME message", "missing@example.com"),
			workerEnv,
			context,
		);
		await waitOnExecutionContext(context);

		const response = await request("/api/v1/mailboxes");
		expect(await response.json()).toEqual([]);
	});

	it("replies and forwards from the receiving mailbox domain", async () => {
		const secondMailbox = "hello@second.test";
		const sentMessages: Array<{ from: string; headers?: Record<string, string> }> = [];
		const emailEnv = {
			...workerEnv,
			EMAIL: {
				send: async (message: { from: string; headers?: Record<string, string> }) => {
					sentMessages.push(message);
					return { messageId: "test-outbound-message-id" };
				},
			},
		} as unknown as TestEnv;
		await createMailbox(secondMailbox, "Second Hello", emailEnv);

		const inboundContext = createExecutionContext();
		await worker.email(
			cloudflareEmailEvent(
				"From: sender@external.test\r\n" +
					"To: first@example.com\r\n" +
					"Subject: Reply target\r\n" +
					"Message-ID: <reply-target@external.test>\r\n" +
					"Content-Type: text/plain; charset=utf-8\r\n" +
					"\r\n" +
					"Please reply\r\n",
				secondMailbox,
			),
			emailEnv,
			inboundContext,
		);
		await waitOnExecutionContext(inboundContext);

		const inboxResponse = await request(
			`/api/v1/mailboxes/${secondMailbox}/emails?folder=inbox`,
			undefined,
			emailEnv,
		);
		const inbox = await inboxResponse.json() as { emails: Array<{ id: string }> };
		const originalId = inbox.emails[0].id;

		const sendFollowUp = async (path: string, subject: string) => {
			const context = createExecutionContext();
			const response = await request(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					to: "sender@external.test",
					from: secondMailbox,
					subject,
					text: "Follow-up",
				}),
			}, emailEnv, context);
			expect(response.status).toBe(202);
			await waitOnExecutionContext(context);
		};

		await sendFollowUp(
			`/api/v1/mailboxes/${secondMailbox}/emails/${originalId}/reply`,
			"Re: Reply target",
		);
		await sendFollowUp(
			`/api/v1/mailboxes/${secondMailbox}/emails/${originalId}/forward`,
			"Fwd: Reply target",
		);

		expect(sentMessages).toHaveLength(2);
		expect(sentMessages.map(({ from }) => from)).toEqual([secondMailbox, secondMailbox]);
		expect(sentMessages.map(({ headers }) => headers?.["Message-ID"])).toEqual([
			expect.stringMatching(/@second\.test>$/),
			expect.stringMatching(/@second\.test>$/),
		]);
	});
});
