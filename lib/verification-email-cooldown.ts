import 'server-only'

import { and, eq, lte } from 'drizzle-orm'
import { emailVerificationCooldowns } from '@/db/schema'
import { database } from './db'
import {
  VERIFICATION_EMAIL_COOLDOWN_SECONDS,
  verificationRetryAfterSeconds,
} from './email-verification'

export type VerificationEmailReservation = {
  firebaseUid: string
  nextAllowedAt: Date
}

export async function reserveVerificationEmail(
  firebaseUid: string,
  email: string,
  now = new Date(),
) {
  const nextAllowedAt = new Date(now.getTime() + VERIFICATION_EMAIL_COOLDOWN_SECONDS * 1_000)
  const reserved = await database()
    .insert(emailVerificationCooldowns)
    .values({
      firebaseUid,
      email: email.trim().toLowerCase(),
      nextAllowedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: emailVerificationCooldowns.firebaseUid,
      set: {
        email: email.trim().toLowerCase(),
        nextAllowedAt,
        updatedAt: now,
      },
      setWhere: lte(emailVerificationCooldowns.nextAllowedAt, now),
    })
    .returning({
      firebaseUid: emailVerificationCooldowns.firebaseUid,
      nextAllowedAt: emailVerificationCooldowns.nextAllowedAt,
    })

  if (reserved[0]) {
    return { allowed: true, reservation: reserved[0] } as const
  }

  const [current] = await database()
    .select({ nextAllowedAt: emailVerificationCooldowns.nextAllowedAt })
    .from(emailVerificationCooldowns)
    .where(eq(emailVerificationCooldowns.firebaseUid, firebaseUid))
    .limit(1)
  return {
    allowed: false,
    retryAfterSeconds: current ? verificationRetryAfterSeconds(current.nextAllowedAt, now) : 1,
  } as const
}

export async function releaseVerificationEmail(reservation: VerificationEmailReservation) {
  await database()
    .delete(emailVerificationCooldowns)
    .where(and(
      eq(emailVerificationCooldowns.firebaseUid, reservation.firebaseUid),
      eq(emailVerificationCooldowns.nextAllowedAt, reservation.nextAllowedAt),
    ))
}

export async function clearVerificationEmailCooldown(firebaseUid: string) {
  await database()
    .delete(emailVerificationCooldowns)
    .where(eq(emailVerificationCooldowns.firebaseUid, firebaseUid))
}
