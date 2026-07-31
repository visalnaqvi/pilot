CREATE TYPE "public"."file_status" AS ENUM('pending', 'attached', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."content_visibility" AS ENUM('public', 'private', 'assigned');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('uploading', 'analyzing', 'analysis_ready', 'generating', 'verification_starting', 'verifying', 'review', 'publishing', 'published', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('mcq', 'short_answer');--> statement-breakpoint
CREATE TYPE "public"."global_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'teacher', 'student');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."email_job_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."attendance_mark" AS ENUM('present', 'absent', 'unmarked');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('draft', 'submitted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."timetable_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."timetable_version_state" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."grading_status" AS ENUM('not_required', 'pending', 'graded');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'done', 'closed');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('basic', 'submission');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"organization_id" uuid,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "files_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"exam_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_exams" (
	"organization_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_exams_organization_id_exam_id_pk" PRIMARY KEY("organization_id","exam_id")
);
--> statement-breakpoint
CREATE TABLE "question_keys" (
	"question_id" uuid PRIMARY KEY NOT NULL,
	"correct_answer" integer,
	"explanation" text,
	"model_answer" text,
	"rubric" jsonb,
	"answer_origin" text,
	"source_references" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"created_by" text NOT NULL,
	"kind" "question_kind" DEFAULT 'mcq' NOT NULL,
	"visibility" "content_visibility" DEFAULT 'private' NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb,
	"format" text DEFAULT 'plain' NOT NULL,
	"prompt_image_path" text,
	"option_image_paths" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"status" "generation_status" DEFAULT 'uploading' NOT NULL,
	"model" text NOT NULL,
	"active_stage" text,
	"active_response_id" text,
	"response_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysis" jsonb,
	"config" jsonb,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latency_ms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title_suggestion" text,
	"description_suggestion" text,
	"failed_stage" text,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"published_test_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage_started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_generation_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_key" text NOT NULL,
	"position" integer NOT NULL,
	"content" jsonb NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verification" jsonb,
	"edited_after_verification" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_generation_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"openai_file_id" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"question_id" uuid,
	"position" integer NOT NULL,
	"marks" integer NOT NULL,
	"snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"exam_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"visibility" "content_visibility" NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"origin" text,
	"generation_job_id" uuid,
	"question_count" integer DEFAULT 0 NOT NULL,
	"total_marks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_group_members" (
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organization_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_exam_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'pending' NOT NULL,
	"initiated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"logo_path" text,
	"profile_photo_path" text,
	"address" text,
	"contact_numbers" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"google_maps_url" text,
	"instagram_url" text,
	"facebook_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"global_role" "global_role" DEFAULT 'user' NOT NULL,
	"profile_photo_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"recipient_user_id" text,
	"recipient_email" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"organization_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "email_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"notification_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"recipient_user_id" text,
	"recipient_organization_id" uuid,
	"global" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"href" text NOT NULL,
	"tone" text NOT NULL,
	"icon" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"visible_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "openai_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"response_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "attendance_marks" (
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"mark" "attendance_mark" DEFAULT 'unmarked' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_marks_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"timetable_version_id" uuid NOT NULL,
	"timetable_entry_id" uuid NOT NULL,
	"class_date" date NOT NULL,
	"status" "attendance_status" DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"cancellation_reason" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"teacher_user_id" text,
	"teacher_label" text,
	"location" text,
	"meeting_url" text,
	"notes" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_entry_days" (
	"entry_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	CONSTRAINT "timetable_entry_days_entry_id_weekday_pk" PRIMARY KEY("entry_id","weekday")
);
--> statement-breakpoint
CREATE TABLE "timetable_version_groups" (
	"version_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "timetable_version_groups_version_id_group_id_pk" PRIMARY KEY("version_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "timetable_version_users" (
	"version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "timetable_version_users_version_id_user_id_pk" PRIMARY KEY("version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "timetable_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timetable_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"state" timetable_version_state DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date NOT NULL,
	"time_zone" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "timetables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" timetable_status DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"current_published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assignment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"assigned_by" text NOT NULL,
	"name" text NOT NULL,
	"audience_name" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"max_attempts" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_recipients" (
	"assignment_batch_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"attempts_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_recipients_assignment_batch_id_user_id_pk" PRIMARY KEY("assignment_batch_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "submission_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_index" integer NOT NULL,
	"question_snapshot" jsonb NOT NULL,
	"response" jsonb,
	"correct_answer" jsonb,
	"awarded_marks" integer,
	"feedback" text,
	"grading_status" "grading_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_organization_access" (
	"submission_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "submission_organization_access_submission_id_organization_id_pk" PRIMARY KEY("submission_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"subject_user_id" text,
	"actor_user_id" text,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignees_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"task_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "task_attachments_task_id_file_id_pk" PRIMARY KEY("task_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_groups" (
	"task_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "task_groups_task_id_group_id_pk" PRIMARY KEY("task_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "task_submission_files" (
	"task_submission_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "task_submission_files_task_submission_id_file_id_pk" PRIMARY KEY("task_submission_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"assignment_batch_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "task_type" NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"is_closed" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_attempt_counters" (
	"test_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_attempt_counters_test_id_user_id_scope_pk" PRIMARY KEY("test_id","user_id","scope")
);
--> statement-breakpoint
CREATE TABLE "test_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"assignment_batch_id" uuid,
	"attempt_number" integer NOT NULL,
	"test_title" text NOT NULL,
	"exam_name" text,
	"category_name" text NOT NULL,
	"visibility" text NOT NULL,
	"grading_status" "grading_status" NOT NULL,
	"score" integer,
	"mcq_score" integer DEFAULT 0 NOT NULL,
	"mcq_marks" integer DEFAULT 0 NOT NULL,
	"pending_marks" integer DEFAULT 0 NOT NULL,
	"total_marks" integer NOT NULL,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"question_count" integer NOT NULL,
	"auto_submitted" boolean DEFAULT false NOT NULL,
	"auto_submit_reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_aliases" ADD CONSTRAINT "exam_aliases_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_exams" ADD CONSTRAINT "organization_exams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_exams" ADD CONSTRAINT "organization_exams_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_exams" ADD CONSTRAINT "organization_exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_keys" ADD CONSTRAINT "question_keys_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_generation_jobs" ADD CONSTRAINT "test_generation_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_generation_jobs" ADD CONSTRAINT "test_generation_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_generation_jobs" ADD CONSTRAINT "test_generation_jobs_published_test_id_tests_id_fk" FOREIGN KEY ("published_test_id") REFERENCES "public"."tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_generation_questions" ADD CONSTRAINT "test_generation_questions_job_id_test_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."test_generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_generation_sources" ADD CONSTRAINT "test_generation_sources_job_id_test_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."test_generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_generation_sources" ADD CONSTRAINT "test_generation_sources_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_questions" ADD CONSTRAINT "test_questions_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_questions" ADD CONSTRAINT "test_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_generation_job_id_test_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."test_generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_group_members" ADD CONSTRAINT "organization_group_members_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_group_members" ADD CONSTRAINT "organization_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_group_members" ADD CONSTRAINT "organization_group_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_groups" ADD CONSTRAINT "organization_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_groups" ADD CONSTRAINT "organization_groups_target_exam_id_exams_id_fk" FOREIGN KEY ("target_exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_groups" ADD CONSTRAINT "organization_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_job_id_email_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."email_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_organization_id_organizations_id_fk" FOREIGN KEY ("recipient_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_marks" ADD CONSTRAINT "attendance_marks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_timetable_version_id_timetable_versions_id_fk" FOREIGN KEY ("timetable_version_id") REFERENCES "public"."timetable_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_timetable_entry_id_timetable_entries_id_fk" FOREIGN KEY ("timetable_entry_id") REFERENCES "public"."timetable_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_version_id_timetable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."timetable_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_user_id_users_id_fk" FOREIGN KEY ("teacher_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entry_days" ADD CONSTRAINT "timetable_entry_days_entry_id_timetable_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timetable_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version_groups" ADD CONSTRAINT "timetable_version_groups_version_id_timetable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."timetable_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version_groups" ADD CONSTRAINT "timetable_version_groups_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version_users" ADD CONSTRAINT "timetable_version_users_version_id_timetable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."timetable_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_version_users" ADD CONSTRAINT "timetable_version_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_versions" ADD CONSTRAINT "timetable_versions_timetable_id_timetables_id_fk" FOREIGN KEY ("timetable_id") REFERENCES "public"."timetables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_versions" ADD CONSTRAINT "timetable_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_current_published_version_id_timetable_versions_id_fk" FOREIGN KEY ("current_published_version_id") REFERENCES "public"."timetable_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_batches" ADD CONSTRAINT "assignment_batches_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_recipients" ADD CONSTRAINT "assignment_recipients_assignment_batch_id_assignment_batches_id_fk" FOREIGN KEY ("assignment_batch_id") REFERENCES "public"."assignment_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_recipients" ADD CONSTRAINT "assignment_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_submission_id_test_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."test_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_organization_access" ADD CONSTRAINT "submission_organization_access_submission_id_test_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."test_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_organization_access" ADD CONSTRAINT "submission_organization_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_groups" ADD CONSTRAINT "task_groups_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_groups" ADD CONSTRAINT "task_groups_group_id_organization_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submission_files" ADD CONSTRAINT "task_submission_files_task_submission_id_task_submissions_id_fk" FOREIGN KEY ("task_submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submission_files" ADD CONSTRAINT "task_submission_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignment_batch_id_assignment_batches_id_fk" FOREIGN KEY ("assignment_batch_id") REFERENCES "public"."assignment_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempt_counters" ADD CONSTRAINT "test_attempt_counters_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_attempt_counters" ADD CONSTRAINT "test_attempt_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_submissions" ADD CONSTRAINT "test_submissions_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_submissions" ADD CONSTRAINT "test_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_submissions" ADD CONSTRAINT "test_submissions_assignment_batch_id_assignment_batches_id_fk" FOREIGN KEY ("assignment_batch_id") REFERENCES "public"."assignment_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_status_idx" ON "files" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "files_organization_idx" ON "files" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_scoped_name_unique" ON "categories" USING btree ("organization_id","exam_id","normalized_name") WHERE "categories"."organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_global_name_unique" ON "categories" USING btree ("exam_id","normalized_name") WHERE "categories"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_aliases_normalized_unique" ON "exam_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "exam_aliases_exam_idx" ON "exam_aliases" USING btree ("exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_normalized_name_unique" ON "exams" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "exams_name_idx" ON "exams" USING btree ("name");--> statement-breakpoint
CREATE INDEX "questions_owner_visibility_idx" ON "questions" USING btree ("created_by","visibility");--> statement-breakpoint
CREATE INDEX "questions_organization_idx" ON "questions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "test_generation_jobs_owner_updated_idx" ON "test_generation_jobs" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "test_generation_jobs_response_idx" ON "test_generation_jobs" USING btree ("active_response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_generation_questions_key_unique" ON "test_generation_questions" USING btree ("job_id","candidate_key");--> statement-breakpoint
CREATE UNIQUE INDEX "test_generation_questions_position_unique" ON "test_generation_questions" USING btree ("job_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "test_generation_sources_position_unique" ON "test_generation_sources" USING btree ("job_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "test_generation_sources_file_unique" ON "test_generation_sources" USING btree ("job_id","file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_questions_position_unique" ON "test_questions" USING btree ("test_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "test_questions_question_unique" ON "test_questions" USING btree ("test_id","question_id");--> statement-breakpoint
CREATE INDEX "tests_visibility_published_idx" ON "tests" USING btree ("visibility","published","deleted_at");--> statement-breakpoint
CREATE INDEX "tests_organization_idx" ON "tests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tests_exam_idx" ON "tests" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "tests_creator_idx" ON "tests" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "organization_group_members_user_idx" ON "organization_group_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_groups_name_unique" ON "organization_groups" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "organization_groups_organization_idx" ON "organization_groups" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_status_idx" ON "organization_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "organization_memberships_org_status_role_idx" ON "organization_memberships" USING btree ("organization_id","status","role");--> statement-breakpoint
CREATE INDEX "organizations_owner_idx" ON "organizations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_job_recipient_unique" ON "email_deliveries" USING btree ("job_id","recipient_email");--> statement-breakpoint
CREATE INDEX "email_deliveries_recipient_idx" ON "email_deliveries" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "email_jobs_due_idx" ON "email_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_jobs_lease_idx" ON "email_jobs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "notifications_user_visible_idx" ON "notifications" USING btree ("recipient_user_id","visible_at");--> statement-breakpoint
CREATE INDEX "notifications_org_visible_idx" ON "notifications" USING btree ("recipient_organization_id","visible_at");--> statement-breakpoint
CREATE INDEX "notifications_global_visible_idx" ON "notifications" USING btree ("global","visible_at");--> statement-breakpoint
CREATE INDEX "openai_webhook_events_response_idx" ON "openai_webhook_events" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "attendance_marks_user_idx" ON "attendance_marks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_revisions_revision_unique" ON "attendance_revisions" USING btree ("session_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_occurrence_unique" ON "attendance_sessions" USING btree ("timetable_version_id","timetable_entry_id","class_date");--> statement-breakpoint
CREATE INDEX "attendance_sessions_organization_date_idx" ON "attendance_sessions" USING btree ("organization_id","class_date");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_entries_position_unique" ON "timetable_entries" USING btree ("version_id","position");--> statement-breakpoint
CREATE INDEX "timetable_version_users_user_idx" ON "timetable_version_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_versions_revision_unique" ON "timetable_versions" USING btree ("timetable_id","revision");--> statement-breakpoint
CREATE INDEX "timetable_versions_state_idx" ON "timetable_versions" USING btree ("timetable_id","state");--> statement-breakpoint
CREATE INDEX "timetables_organization_status_idx" ON "timetables" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "assignment_batches_organization_idx" ON "assignment_batches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "assignment_batches_test_idx" ON "assignment_batches" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "assignment_recipients_user_idx" ON "assignment_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_answers_question_unique" ON "submission_answers" USING btree ("submission_id","question_index");--> statement-breakpoint
CREATE INDEX "submission_organization_access_org_idx" ON "submission_organization_access" USING btree ("organization_id","submission_id");--> statement-breakpoint
CREATE INDEX "task_activity_task_created_idx" ON "task_activity" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_assignees_user_status_idx" ON "task_assignees" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "task_attachments_position_unique" ON "task_attachments" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "task_comments_task_created_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_submission_files_position_unique" ON "task_submission_files" USING btree ("task_submission_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "task_submissions_task_user_unique" ON "task_submissions" USING btree ("task_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_assignment_unique" ON "tasks" USING btree ("assignment_batch_id") WHERE "tasks"."assignment_batch_id" is not null;--> statement-breakpoint
CREATE INDEX "tasks_organization_idx" ON "tasks" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_creator_idx" ON "tasks" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "test_submissions_assignment_attempt_unique" ON "test_submissions" USING btree ("assignment_batch_id","user_id","attempt_number") WHERE "test_submissions"."assignment_batch_id" is not null;--> statement-breakpoint
CREATE INDEX "test_submissions_test_submitted_idx" ON "test_submissions" USING btree ("test_id","submitted_at");--> statement-breakpoint
CREATE INDEX "test_submissions_user_submitted_idx" ON "test_submissions" USING btree ("user_id","submitted_at");