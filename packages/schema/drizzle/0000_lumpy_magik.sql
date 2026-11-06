CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_digest" varchar(128) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider" varchar(64) NOT NULL,
	"model" varchar(64) NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	"finish_reason" varchar(32),
	"request_json" jsonb NOT NULL,
	"response_json" jsonb,
	"error_message" text,
	"error_category" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt" text DEFAULT '',
	"state" varchar(32) DEFAULT 'queued' NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"claim_token" text,
	"claim_version" integer DEFAULT 0 NOT NULL,
	"claim_expires_at" timestamp with time zone,
	"model_profile" varchar(64),
	"result_content" text,
	"error_message" text,
	"terminal_reason" varchar(64),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_attempts" ADD CONSTRAINT "model_attempts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_run_sequence_idx" ON "events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "events_run_id_idx" ON "events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "model_attempts_run_id_idx" ON "model_attempts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_state_idx" ON "runs" USING btree ("state");