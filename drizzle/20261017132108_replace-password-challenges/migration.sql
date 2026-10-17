-- Custom SQL migration file, put your code below! --
UPDATE session_games
SET definition = json_set(definition, '$.areas', json((
  SELECT json_group_array(json(
    CASE WHEN json_extract(value, '$.kind') = 'password'
      THEN json_set(value, '$.kind', 'text')
      ELSE value
    END
  ))
  FROM json_each(session_games.definition, '$.areas')
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(session_games.definition, '$.areas')
  WHERE json_extract(value, '$.kind') = 'password'
);
