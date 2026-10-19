CREATE TABLE `session_timing` (
	`session_id` text PRIMARY KEY,
	`elapsed_ms` integer NOT NULL,
	`resumed_at` integer,
	CONSTRAINT `fk_session_timing_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);
