CREATE TABLE `balls` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`coverstock` text,
	`layout` text,
	`surface` text,
	`weight` real,
	`retired` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `frames` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`game_id` text NOT NULL,
	`frame_no` integer NOT NULL,
	`throws` text NOT NULL,
	`ball_id_per_throw` text NOT NULL,
	`pin_state` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`owner_user_id` text NOT NULL,
	`session_id` text,
	`player_id` text NOT NULL,
	`league_id` text,
	`date` text NOT NULL,
	`location_id` text,
	`lane` text,
	`oil_pattern_id` text,
	`notes` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`oil_pattern_id`) REFERENCES `oil_patterns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lane_condition_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`owner_user_id` text NOT NULL,
	`location_id` text NOT NULL,
	`session_id` text,
	`date` text NOT NULL,
	`oil_pattern_id` text,
	`freshness` text,
	`play_style` text,
	`carrydown` text,
	`hold_notes` text,
	`breakpoint_notes` text,
	`rating_1_to_5` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`oil_pattern_id`) REFERENCES `oil_patterns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leagues` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`name` text NOT NULL,
	`season` text,
	`house` text
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`lat` real,
	`lng` real,
	`lane_count` integer,
	`pinsetter_type` text,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `oil_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`name` text NOT NULL,
	`length_ft` integer,
	`volume` integer,
	`ratio` real,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`is_self` integer DEFAULT false NOT NULL,
	`avatar` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_one_self_per_user` ON `players` (`user_id`) WHERE "players"."is_self" = 1 AND "players"."user_id" IS NOT NULL AND "players"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `session_players` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`session_id` text NOT NULL,
	`player_id` text NOT NULL,
	`turn_order` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`owner_user_id` text NOT NULL,
	`date` text NOT NULL,
	`location_id` text,
	`lane` text,
	`oil_pattern_id` text,
	`is_group` integer DEFAULT false NOT NULL,
	`notes` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`oil_pattern_id`) REFERENCES `oil_patterns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`sync_status` text DEFAULT 'pending' NOT NULL
);
