import { z } from "zod";

export const entryLockAcquireBody = z
	.object({
		takeover: z.boolean().optional().meta({
			description:
				"Take the lock from whoever holds it. Their next save is refused so they learn the entry moved on.",
		}),
	})
	.meta({ id: "EntryLockAcquireBody" });

export const entryLockHolderSchema = z
	.object({
		userId: z.string(),
		userName: z.string().nullable(),
		acquiredAt: z.string(),
		expiresAt: z.string(),
	})
	.meta({ id: "EntryLockHolder" });

export const entryLockStatusSchema = z
	.object({
		enabled: z.boolean().meta({
			description: "Whether the collection takes edit locks at all",
		}),
		holder: entryLockHolderSchema.nullable(),
		heldByCaller: z.boolean(),
	})
	.meta({ id: "EntryLockStatus" });

export const entryLockReleaseResponseSchema = z
	.object({ released: z.boolean() })
	.meta({ id: "EntryLockReleaseResponse" });

export type EntryLockAcquireBody = z.infer<typeof entryLockAcquireBody>;
