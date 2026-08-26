// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface MailboxPolicy {
	domains: string[];
	emailAddresses: string[];
}

export function normalizeDomain(domain: string): string {
	return domain.trim().toLowerCase().replace(/\.+$/, "");
}

export function normalizeEmailAddress(email: string): string {
	const normalized = email.trim().toLowerCase();
	const atIndex = normalized.lastIndexOf("@");
	if (atIndex < 0) return normalized;

	return `${normalized.slice(0, atIndex)}@${normalizeDomain(normalized.slice(atIndex + 1))}`;
}

export function getMailboxPolicy(
	domainsRaw: string | undefined,
	exactAddressesRaw: readonly string[] | undefined,
): MailboxPolicy {
	const domains = [...new Set(
		(domainsRaw || "")
			.split(",")
			.map(normalizeDomain)
			.filter(Boolean),
	)];
	const emailAddresses = [...new Set(
		(exactAddressesRaw || [])
			.map(normalizeEmailAddress)
			.filter(Boolean),
	)];

	return { domains, emailAddresses };
}

export function isAllowedMailboxAddress(
	email: string,
	policy: MailboxPolicy,
): boolean {
	const normalizedEmail = normalizeEmailAddress(email);
	if (policy.emailAddresses.length > 0) {
		return policy.emailAddresses.includes(normalizedEmail);
	}

	if (policy.domains.length === 0) return false;
	const atIndex = normalizedEmail.lastIndexOf("@");
	if (atIndex < 0) return false;

	return policy.domains.includes(normalizedEmail.slice(atIndex + 1));
}
