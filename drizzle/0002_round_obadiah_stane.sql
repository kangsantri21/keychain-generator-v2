CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_code` text NOT NULL,
	`manual_code` text NOT NULL,
	`template_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`customer_names` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
