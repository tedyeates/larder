CREATE TABLE "ticktick_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"client_id" text,
	"client_secret" text,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"project_id" text,
	"project_name" text,
	"connected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticktick_settings" ADD CONSTRAINT "ticktick_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;