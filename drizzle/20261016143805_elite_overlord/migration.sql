CREATE TABLE IF NOT EXISTS `admins` (
	`token` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` text,
	`message` text NOT NULL,
	`created` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `players` (
	`token` text PRIMARY KEY,
	`name` text NOT NULL,
	`session_id` text NOT NULL,
	CONSTRAINT `fk_players_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`created` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
