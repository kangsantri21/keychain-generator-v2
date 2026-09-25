CREATE TABLE `mahar_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_code` text NOT NULL,
	`layout_data` text NOT NULL,
	`canvas_width` integer NOT NULL,
	`canvas_height` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mahar_batches_batch_code_unique` ON `mahar_batches` (`batch_code`);--> statement-breakpoint
CREATE TABLE `mahar_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bride_name` text NOT NULL,
	`groom_name` text NOT NULL,
	`wedding_date` text NOT NULL,
	`nominal` text NOT NULL,
	`frame_shape` text NOT NULL,
	`size` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
