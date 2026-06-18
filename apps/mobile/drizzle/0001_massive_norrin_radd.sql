CREATE TABLE `sync_ops` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_table` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`payload` text,
	`entity_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
