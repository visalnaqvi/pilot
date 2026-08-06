CREATE TABLE "email_verification_cooldowns" (
	"firebase_uid" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"next_allowed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
