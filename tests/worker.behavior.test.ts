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

async function request(path: string, init?: RequestInit, requestEnv: Env = workerEnv) {
	return worker.fetch(
		new Request(`https://worker.test${path}`, init),
		requestEnv,
		createExecutionContext(),
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

function cloudflareEmailEvent(rawMessage: string): ForwardableEmailMessage {
	const from = "sender@external.test";
	const to = mailboxAddress;
	const raw = new TextEncoder().encode(rawMessage);

	return {
		from,
		to,
		headers: new Headers({
			From: from,
			To: to,
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
});
