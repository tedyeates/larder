CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_slug_idx" ON "categories" USING btree ("user_id","slug");--> statement-breakpoint
ALTER TABLE "ingredients" ALTER COLUMN "category" DROP DEFAULT;--> statement-breakpoint
INSERT INTO "categories" ("user_id", "name", "slug", "sort_order")
SELECT u."id", d."name", d."slug", d."sort_order"
FROM "users" u
CROSS JOIN (VALUES
	('Produce', 'produce', 0),
	('Dairy', 'dairy', 1),
	('Meat', 'meat', 2),
	('Fish', 'fish', 3),
	('Bakery', 'bakery', 4),
	('Dry goods', 'dry', 5),
	('Frozen', 'frozen', 6),
	('Tins', 'tins', 7),
	('Drinks', 'drinks', 8),
	('Other', 'other', 9)
) AS d("name", "slug", "sort_order");--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "category_new" uuid;--> statement-breakpoint
UPDATE "ingredients" i
SET "category_new" = c."id"
FROM "categories" c
WHERE c."user_id" = i."user_id" AND c."slug" = i."category"::text;--> statement-breakpoint
ALTER TABLE "ingredients" ALTER COLUMN "category_new" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "ingredients" RENAME COLUMN "category_new" TO "category";--> statement-breakpoint
CREATE INDEX "ingredients_user_category_idx" ON "ingredients" USING btree ("user_id","category");--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_category_categories_id_fk" FOREIGN KEY ("category") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."ingredient_category";
