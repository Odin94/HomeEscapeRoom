CREATE TABLE `session_games` (
	`session_id` text PRIMARY KEY,
	`definition` text NOT NULL,
	CONSTRAINT `fk_session_games_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);
