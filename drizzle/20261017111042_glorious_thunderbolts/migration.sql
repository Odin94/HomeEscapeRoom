CREATE TABLE `action_runs` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	CONSTRAINT `fk_action_runs_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_automation` (
	`session_id` text PRIMARY KEY,
	`token` text NOT NULL,
	CONSTRAINT `fk_session_automation_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);
