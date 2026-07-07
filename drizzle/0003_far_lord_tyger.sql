CREATE TABLE `staging_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`template_id` integer NOT NULL,
	`customer_name` text NOT NULL,
	`sheet_id` integer NOT NULL,
	`pos_x` real NOT NULL,
	`pos_y` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
