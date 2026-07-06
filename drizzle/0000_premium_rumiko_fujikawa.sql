CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`file_path` text NOT NULL,
	`thumbnail_path` text NOT NULL,
	`colors` text NOT NULL,
	`is_character` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_code_unique` ON `templates` (`code`);