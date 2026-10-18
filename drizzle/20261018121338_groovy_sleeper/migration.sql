CREATE TABLE `session_timers` (
	`session_id` text PRIMARY KEY,
	`remaining_ms` integer NOT NULL,
	`resumed_at` integer,
	CONSTRAINT `fk_session_timers_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);
