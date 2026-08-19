CREATE TABLE "attendance_qr_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"window_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_qr_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"opened_by" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attendance_qr_check_ins" ADD CONSTRAINT "attendance_qr_check_ins_window_id_attendance_qr_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."attendance_qr_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_qr_check_ins" ADD CONSTRAINT "attendance_qr_check_ins_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_qr_check_ins" ADD CONSTRAINT "attendance_qr_check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_qr_windows" ADD CONSTRAINT "attendance_qr_windows_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_qr_windows" ADD CONSTRAINT "attendance_qr_windows_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_qr_windows" ADD CONSTRAINT "attendance_qr_windows_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_qr_check_ins_session_user_unique" ON "attendance_qr_check_ins" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "attendance_qr_check_ins_window_idx" ON "attendance_qr_check_ins" USING btree ("window_id");--> statement-breakpoint
CREATE INDEX "attendance_qr_check_ins_user_idx" ON "attendance_qr_check_ins" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_qr_windows_one_unclosed_unique" ON "attendance_qr_windows" USING btree ("session_id") WHERE "attendance_qr_windows"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "attendance_qr_windows_session_expiry_idx" ON "attendance_qr_windows" USING btree ("session_id","expires_at");