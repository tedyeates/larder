ALTER TABLE "cook_events" DROP CONSTRAINT "cook_events_recipe_id_recipes_id_fk";
--> statement-breakpoint
ALTER TABLE "meal_plan_entries" DROP CONSTRAINT "meal_plan_entries_recipe_id_recipes_id_fk";
--> statement-breakpoint
ALTER TABLE "cook_events" ALTER COLUMN "recipe_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cook_events" ADD COLUMN "recipe_label" text;--> statement-breakpoint
ALTER TABLE "cook_events" ADD CONSTRAINT "cook_events_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "cook_events" SET "recipe_label" = "recipes"."title" FROM "recipes" WHERE "recipes"."id" = "cook_events"."recipe_id" AND "cook_events"."recipe_label" IS NULL;
