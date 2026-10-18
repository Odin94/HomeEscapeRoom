import type { Clue } from "../lib/clue";
import { GameMarkdown } from "./game-markdown";

export function ClueView({ clue }: { clue: Clue }) {
  if (clue.kind === "markdown")
    return <GameMarkdown>{clue.content}</GameMarkdown>;
  if (clue.kind === "image")
    return <img className="clue-media" src={clue.content} alt={clue.name} />;
  if (clue.kind === "audio")
    return (
      <audio className="clue-media" controls preload="none" src={clue.content}>
        Your browser cannot play this audio.
      </audio>
    );
  return (
    <video
      className="clue-media"
      controls
      preload="metadata"
      src={clue.content}
    >
      Your browser cannot play this video.
    </video>
  );
}
