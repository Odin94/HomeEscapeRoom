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
    { label: string; detail: string; image: string }[] | null
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
          detail: "Choose this game on the join page",
          url: `${origin}/`,
        },
        ...game.areas.flatMap((area, index) =>
          area.kind === "qr" && area.unlockCode?.trim()
            ? [
                {
                  label: area.name,
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
        One A4 sheet with a start / join code and all QR answers, labeled with
        cutting guides. Choose Save as PDF in the print dialog. Save game
        changes before printing.
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
            <h1>
              <GameMarkdown inline>{game.name}</GameMarkdown> — QR codes
            </h1>
            <div
              className="game-qr-print-grid"
              style={{
                gridTemplateColumns: `repeat(${sheet.length <= 6 ? 2 : sheet.length <= 12 ? 3 : sheet.length <= 20 ? 4 : 5}, minmax(0, 1fr))`,
              }}
            >
              {sheet.map((code, index) => (
                <section key={index}>
                  <img src={code.image} alt={code.label} />
                  <strong>
                    <GameMarkdown inline>{code.label}</GameMarkdown>
                  </strong>
                  <small>{code.detail}</small>
                </section>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
