/**
 * POST /_emdash/api/auth/invite/complete
 *
 * Complete the invite by registering a passkey for the new user.
 * This creates the user account and establishes a session.
 */

import type { APIRoute } from "astro";

export const prerender = false;

import { completeInvite, InviteError } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { verifyRegistrationResponse, registerPasskey } from "@emdash-cms/auth/passkey";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { getPublicOrigin } from "#api/public-url.js";
import { inviteCompleteBody } from "#api/schemas.js";
import { getConfiguredAllowedOrigins, validateAllowedOrigins } from "#auth/allowed-origins.js";
import { createChallengeStore } from "#auth/challenge-store.js";
import { getPasskeyConfig } from "#auth/passkey-config.js";
import { OptionsRepository } from "#db/repositories/options.js";
import { withTransaction } from "#db/transaction.js";

import { sessionUnavailableError } from "../../../../session-user.js";

export const POST: APIRoute = async ({ request, locals, session }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	if (!session) return sessionUnavailableError();

	try {
		const body = await parseBody(request, inviteCompleteBody);
		if (isParseError(body)) return body;

		// Get passkey config
		const url = new URL(request.url);
		const options = new OptionsRepository(emdash.db);
		const siteName = (await options.get<string>("emdash:site_title")) ?? undefined;
		const siteUrl = getPublicOrigin(url, emdash?.config);
		const allowedOrigins = validateAllowedOrigins(
			siteUrl,
			getConfiguredAllowedOrigins(emdash?.config),
		);
		const passkeyConfig = getPasskeyConfig(url, siteName, siteUrl, allowedOrigins);

		// Verify the passkey registration response
		const challengeStore = createChallengeStore(emdash.db);
		const verified = await verifyRegistrationResponse(
			passkeyConfig,
			body.credential,
			challengeStore,
		);

		// The invite is consumed and the user created in one transaction, so a
		// role deleted in between cannot leave a used-up invite and no user.
		const user = await withTransaction(emdash.db, async (trx) => {
			const trxAdapter = createKyselyAdapter(trx);
			const created = await completeInvite(trxAdapter, body.token, {
				name: body.name,
			});
			await registerPasskey(trxAdapter, created.id, verified, "Initial passkey");
			return created;
		});

		session.set("user", { id: user.id });

		return apiSuccess({
			success: true,
			user: {
				id: user.id,
				email: user.email,
				name: user.name,
				role: user.role,
			},
		});
	} catch (error) {
		if (error instanceof InviteError) {
			const statusMap: Record<string, number> = {
				invalid_token: 404,
				token_expired: 410,
				user_exists: 409,
			};
			return apiError(error.code.toUpperCase(), error.message, statusMap[error.code] ?? 400);
		}

		return handleError(error, "Failed to complete invite", "INVITE_COMPLETE_ERROR");
	}
};
