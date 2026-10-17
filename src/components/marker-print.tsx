import { useState } from "react";
import Markdown from "react-markdown";
import { Button } from "./ui";

export function MarkerContent({
  qr,
  above,
  below,
}: {
  qr: string;
  above: string;
  below: string;
}) {
  return (
    <div className="marker-content">
      {above.trim() && <Markdown skipHtml>{above}</Markdown>}
      <img src={qr} alt="Room marker" width={320} height={320} />
      {below.trim() && <Markdown skipHtml>{below}</Markdown>}
    </div>
  );
}

export function MarkerPrint({ qr, close }: { qr: string; close: () => void }) {
  const [above, setAbove] = useState("");
  const [below, setBelow] = useState("");
  return (
    <section className="panel qr">
      <div className="marker-editor">
        <label>
          Text above the code (Markdown)
          <textarea
            value={above}
            onChange={(event) => setAbove(event.target.value)}
            placeholder="# Your heading"
            rows={3}
          />
        </label>
        <label>
          Text below the code (Markdown)
          <textarea
            value={below}
            onChange={(event) => setBelow(event.target.value)}
            placeholder="Add a **clue** or instructions"
            rows={3}
          />
        </label>
      </div>
      <MarkerContent qr={qr} above={above} below={below} />
      <div className="actions marker-editor">
        <Button onClick={() => window.print()}>Print marker</Button>
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
      </div>
    </section>
  );
}
