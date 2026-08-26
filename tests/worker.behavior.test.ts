import { env } from "cloudflare:workers";
import type { ForwardableEmailMessage } from "@cloudflare/workers-types";
import worker from "../workers/app";
import type { Env } from "../workers/types";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const mailboxAddress = "hello@example.com";
const workerEnv = env as Env;

async function request(path: string, init?: RequestInit) {
	return worker.fetch(
		new Request(`https://worker.test${path}`, init),
		workerEnv,
		createExecutionContext(),
	);
}

async function createMailbox() {
	const response = await request("/api/v1/mailboxes", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: mailboxAddress,
			name: "Hello",
		}),
	});

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
