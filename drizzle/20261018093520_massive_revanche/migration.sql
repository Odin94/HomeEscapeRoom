CREATE TABLE `challenge_completions` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	CONSTRAINT `fk_challenge_completions_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);

--> statement-breakpoint
INSERT INTO challenge_completions (id, session_id, challenge_id)
SELECT s.id || ':' || json_extract(a.value, '$.id'), s.id, json_extract(a.value, '$.id')
FROM sessions s JOIN session_games g ON g.session_id = s.id, json_each(g.definition, '$.areas') a
WHERE CAST(a.key AS INTEGER) < s.progress;
