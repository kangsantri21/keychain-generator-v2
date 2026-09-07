CREATE TABLE `print_batches` (
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
CREATE UNIQUE INDEX `print_batches_batch_code_unique` ON `print_batches` (`batch_code`);--> statement-breakpoint
ALTER TABLE `order_items` ADD `batch_id` integer REFERENCES print_batches(id);