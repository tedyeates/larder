CREATE TYPE "public"."creator" AS ENUM('manual', 'agent');--> statement-breakpoint
CREATE TYPE "public"."ingredient_category" AS ENUM('produce', 'dairy', 'meat', 'fish', 'bakery', 'dry', 'frozen', 'tins', 'drinks', 'other');--> statement-breakpoint
CREATE TYPE "public"."leftover_status" AS ENUM('available', 'reserved', 'eaten', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."list_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TYPE "public"."plan_entry_kind" AS ENUM('recipe', 'leftover');--> statement-breakpoint
CREATE TYPE "public"."plan_entry_status" AS ENUM('planned', 'cooked', 'eaten', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."plan_slot" AS ENUM('lunch', 'dinner');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."shopping_item_origin" AS ENUM('generated', 'manual');--> statement-breakpoint
CREATE TYPE "public"."shopping_item_status" AS ENUM('pending', 'ticked', 'removed');--> statement-breakpoint
CREATE TYPE "public"."stock_reason" AS ENUM('purchase', 'cook', 'adjust', 'discard');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"plan_entry_id" uuid,
	"portions_cooked" numeric(8, 2) DEFAULT 1 NOT NULL,
	"eaten_now" numeric(8, 2) DEFAULT 1 NOT NULL,
	"cooked_at" date NOT NULL,
	"shortfall_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" "ingredient_category" DEFAULT 'other' NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"stock_unit" text NOT NULL,
	"grams_per" jsonb,
	"shelf_life_days" integer,
	"min_stock" numeric(14, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leftovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cook_event_id" uuid,
	"recipe_id" uuid,
	"label" text NOT NULL,
	"portions" numeric(8, 2) NOT NULL,
	"stored_at" date NOT NULL,
	"best_before" date,
	"status" "leftover_status" DEFAULT 'available' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"day" date NOT NULL,
	"slot" "plan_slot" NOT NULL,
	"kind" "plan_entry_kind" DEFAULT 'recipe' NOT NULL,
	"recipe_id" uuid,
	"leftover_id" uuid,
	"portions" numeric(8, 2) DEFAULT 1 NOT NULL,
	"status" "plan_entry_status" DEFAULT 'planned' NOT NULL,
	"cook_event_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"created_by" "creator" DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"raw_text" text NOT NULL,
	"quantity" numeric(14, 6),
	"unit" text,
	"note" text,
	"is_optional" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"parse_status" text DEFAULT 'unmatched' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"servings" integer DEFAULT 2 NOT NULL,
	"prep_minutes" integer,
	"cook_minutes" integer,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"image_url" text,
	"created_by" "creator" DEFAULT 'manual' NOT NULL,
	"raw_jsonld" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"label" text NOT NULL,
	"quantity" numeric(14, 6),
	"unit" text,
	"note" text,
	"status" "shopping_item_status" DEFAULT 'pending' NOT NULL,
	"origin" "shopping_item_origin" DEFAULT 'manual' NOT NULL,
	"ticked_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"ticktick_task_id" text,
	"ticktick_project_id" text,
	"resulting_stock_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT 'Shopping' NOT NULL,
	"status" "list_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" numeric(14, 6) NOT NULL,
	"unit_as_entered" text,
	"quantity_as_entered" numeric(14, 6),
	"reason" "stock_reason" NOT NULL,
	"acquired_at" date NOT NULL,
	"best_before" date,
	"cook_event_id" uuid,
	"shopping_item_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_events" ADD CONSTRAINT "cook_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cook_events" ADD CONSTRAINT "cook_events_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftovers" ADD CONSTRAINT "leftovers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftovers" ADD CONSTRAINT "leftovers_cook_event_id_cook_events_id_fk" FOREIGN KEY ("cook_event_id") REFERENCES "public"."cook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leftovers" ADD CONSTRAINT "leftovers_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_leftover_id_leftovers_id_fk" FOREIGN KEY ("leftover_id") REFERENCES "public"."leftovers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_cook_event_id_cook_events_id_fk" FOREIGN KEY ("cook_event_id") REFERENCES "public"."cook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_cook_event_id_cook_events_id_fk" FOREIGN KEY ("cook_event_id") REFERENCES "public"."cook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "cook_events_user_idx" ON "cook_events" USING btree ("user_id","cooked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_user_slug_idx" ON "ingredients" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "ingredients_user_category_idx" ON "ingredients" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "leftovers_user_status_idx" ON "leftovers" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "meal_plan_entries_plan_idx" ON "meal_plan_entries" USING btree ("plan_id","day","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plan_entries_slot_idx" ON "meal_plan_entries" USING btree ("plan_id","day","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plans_user_week_idx" ON "meal_plans" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_idx" ON "recipe_ingredients" USING btree ("recipe_id","sort_order");--> statement-breakpoint
CREATE INDEX "recipes_user_idx" ON "recipes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shopping_items_list_idx" ON "shopping_items" USING btree ("list_id","status");--> statement-breakpoint
CREATE INDEX "stock_entries_ingredient_idx" ON "stock_entries" USING btree ("ingredient_id","acquired_at");--> statement-breakpoint
CREATE INDEX "stock_entries_user_idx" ON "stock_entries" USING btree ("user_id");--> statement-breakpoint
CREATE VIEW "public"."pantry_balance" AS (select "ingredient_id", sum("quantity") as "quantity" from "stock_entries" group by "stock_entries"."ingredient_id");