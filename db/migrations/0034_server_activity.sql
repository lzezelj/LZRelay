CREATE TABLE "server_activity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "server_id" uuid NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
  "actor_id" uuid NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "server_activity_timeline_idx" ON "server_activity" ("server_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "server_activity_expiry_idx" ON "server_activity" ("created_at");
