ALTER TABLE "model_attempts" ALTER COLUMN "cost_usd" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_attempts" ADD COLUMN "pricing" varchar(16) DEFAULT 'priced' NOT NULL;--> statement-breakpoint
