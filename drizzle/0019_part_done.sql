ALTER TABLE `staging_items` ADD `part_done` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `staging_items` SET `part_done` = 1 WHERE `status` = 'completed';
