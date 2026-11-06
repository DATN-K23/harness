ALTER TABLE "runs" ADD COLUMN "snapshot_id" text;--> statement-breakpoint
ALTER TABLE "model_attempts" ADD COLUMN "step_index" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_attempts" ADD COLUMN "attempt_purpose" varchar(32) DEFAULT 'reasoning' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_attempts_run_step_purpose_attempt_idx" ON "model_attempts" USING btree ("run_id","step_index","attempt_purpose","attempt_number");
