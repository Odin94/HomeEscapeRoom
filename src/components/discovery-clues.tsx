import type { Area } from "../lib/game-store";
import { GameMarkdown } from "./game-markdown";
import { Listen } from "./voice-controls";

export function DiscoveryClues({
  areas,
  voiceEnabled,
}: {
  areas: Area[];
  voiceEnabled?: boolean;
}) {
  return areas
    .filter(
      (area) =>
        area.available &&
        area.hint &&
        (area.kind === "hidden" ||
          (area.kind === "qr" && area.qrMode !== "prompted")),
    )
    .map((area) => (
      <section key={area.id} aria-label={area.name}>
        <GameMarkdown>{area.hint}</GameMarkdown>
        {voiceEnabled && <Listen source="hint" contentId={area.id} />}
      </section>
    ));
}
