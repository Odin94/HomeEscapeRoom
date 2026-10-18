import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import type { Game } from "../lib/game-store";
import { GameMarkdown } from "./game-markdown";
import { Button } from "./ui";

export function GameQrPrint({
  game,
  origin,
}: {
  game: Game;
  origin?: string | null;
}) {
  const [sheet, setSheet] = useState<
    { label: string; detail: string; hint: string; image: string }[] | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const printed = useRef(false);
  useEffect(() => {
    const done = () => setSheet(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  async function prepare() {
    if (!origin) return;
    setBusy(true);
    setError("");
    printed.current = false;
    try {
      const codes = [
        {
          label: "Start / join game",
          hint: "",
          detail: "Choose this game on the join page",
          url: `${origin}/`,
        },
        ...game.areas.flatMap((area, index) =>
          area.kind === "qr" && area.unlockCode?.trim()
            ? [
                {
                  label: area.name,
                  hint: [area.hint.trim(), area.description.trim()]
                    .filter(
                      (text, index, texts) =>
                        text && texts.indexOf(text) === index,
                    )
                    .join("\n\n"),
                  detail: `Answer · Challenge ${index + 1} · ${area.id}`,
                  url: `${origin}/?code=${encodeURIComponent(area.unlockCode)}`,
                },
              ]
            : [],
        ),
      ];
      setSheet(
        await Promise.all(
          codes.map(async ({ url, ...code }) => ({
            ...code,
            image: await QRCode.toDataURL(url, {
              width: 640,
              margin: 4,
              errorCorrectionLevel: "M",
            }),
          })),
        ),
      );
    } catch {
      setError("Could not generate the QR sheet. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={!origin || busy}
        onClick={() => void prepare()}
      >
        {busy ? "Generating QR codes…" : "Print all QR codes / PDF"}
      </Button>
      <p>
        Eight codes per A4 page, including a start / join code and all QR
        answers, labeled with cutting guides and challenge hints and
        descriptions in fine print. Choose Save as PDF in the print dialog. Save
        game changes before printing.
      </p>
      {!origin && (
        <p>
          Configure a public game URL or connect to a private LAN to print QR
          codes.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {sheet &&
        createPortal(
          <div
            className="game-qr-print-sheet"
            ref={(element) => {
              if (!element) return;
              void Promise.all(
                Array.from(element.querySelectorAll("img")).map((image) =>
                  image.decode(),
                ),
              )
                .then(() => {
                  if (printed.current || !element.isConnected) return;
                  printed.current = true;
                  window.print();
                  setSheet(null);
                })
                .catch(() => {
                  setSheet(null);
                  setError("Could not load the QR images. Please try again.");
                });
            }}
          >
            {Array.from({ length: Math.ceil(sheet.length / 8) }, (_, page) => (
              <div className="game-qr-print-page" key={page}>
                <h1>
                  <GameMarkdown inline>{game.name}</GameMarkdown> — QR codes
                  {sheet.length > 8 && ` · Page ${page + 1}`}
                </h1>
                <div className="game-qr-print-grid">
                  {sheet.slice(page * 8, (page + 1) * 8).map((code, index) => (
                    <section key={index}>
                      <img src={code.image} alt={code.label} />
                      <strong>
                        <GameMarkdown inline>{code.label}</GameMarkdown>
                      </strong>
                      <small>{code.detail}</small>
                      {code.hint.trim() && (
                        <div className="game-qr-print-hint">
                          <GameMarkdown inline>{code.hint}</GameMarkdown>
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
