import { useState } from "react";
import type { Clue } from "../lib/clue";
import { clueSchema } from "../lib/clue";
import { ClueView } from "./clue-view";
import { Button } from "./ui";
import { RemoveButton } from "./game-editor";

export function ClueEditor({
  clues,
  change,
}: {
  clues: Clue[];
  change: (clues: Clue[]) => void;
}) {
  const [error, setError] = useState("");
  const patch = (index: number, value: Partial<Clue>) =>
    change(clues.map((c, i) => (i === index ? { ...c, ...value } : c)));
  return (
    <fieldset>
      <legend>Clue library</legend>
      <p>
        Clues are separate from challenges. Choose which ones each solved
        challenge reveals. Files are stored with the game and frozen into each
        session. Up to 5 MB per file, 24 MB total.
      </p>
      {error && <p role="alert">{error}</p>}
      {clues.map((clue, index) => (
        <details className="challenge-editor" open key={index}>
          <summary>
            {clue.name || "New clue"}
            <RemoveButton
              label="Remove clue"
              configured={!!clue.content}
              remove={() => change(clues.filter((_, i) => i !== index))}
            />
          </summary>
          <label>
            Clue ID
            <input
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={80}
              value={clue.id}
              onChange={(e) => patch(index, { id: e.target.value })}
            />
          </label>
          <label>
            Clue name
            <input
              required
              maxLength={80}
              value={clue.name}
              onChange={(e) => patch(index, { name: e.target.value })}
            />
          </label>
          <label>
            Clue format
            <select
              value={clue.kind}
              onChange={(e) =>
                patch(index, {
                  kind: e.target.value as Clue["kind"],
                  content: "",
                })
              }
            >
              {["markdown", "image", "audio", "video"].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          {clue.kind === "markdown" ? (
            <label>
              Markdown text
              <textarea
                required
                maxLength={10000}
                value={clue.content}
                onChange={(e) => patch(index, { content: e.target.value })}
              />
            </label>
          ) : (
            <label>
              Clue file
              <input
                type="file"
                accept={
                  clue.kind === "image"
                    ? "image/png,image/jpeg,image/gif,image/webp"
                    : `${clue.kind}/*`
                }
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    setError("Choose a file smaller than 5 MB.");
                    e.target.value = "";
                    return;
                  }
                  const reader = new FileReader();
                  reader.onerror = () => setError("Could not read this file.");
                  reader.onload = () => {
                    const content = String(reader.result);
                    const result = clueSchema.safeParse({
                      ...clue,
                      content,
                      id: clue.id || "clue",
                      name: clue.name || "Clue",
                    });
                    if (!result.success) {
                      setError(result.error.issues[0].message);
                      return;
                    }
                    setError("");
                    patch(index, { content });
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          )}
          {clue.content && (
            <details>
              <summary>Player preview</summary>
              <ClueView clue={clue} />
            </details>
          )}
        </details>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={clues.length >= 50}
        onClick={() => {
          let n = clues.length + 1;
          while (clues.some((c) => c.id === `clue-${n}`)) n++;
          change([
            ...clues,
            {
              id: `clue-${n}`,
              name: "New clue",
              kind: "markdown",
              content: "",
            },
          ]);
        }}
      >
        Add clue
      </Button>
    </fieldset>
  );
}
