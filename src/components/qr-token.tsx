import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Button } from "./ui";

export function QrToken({ token, origin }: { token: string; origin?: string }) {
  const url =
    origin && token.trim()
      ? `${origin}/?code=${encodeURIComponent(token)}`
      : "";
  const [result, setResult] = useState({ url: "", image: "", error: false });
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!url) return;
    let active = true;
    void QRCode.toDataURL(url, { width: 320, margin: 4 }).then(
      (image) => {
        if (active) setResult({ url, image, error: false });
      },
      () => {
        if (active) setResult({ url, image: "", error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [url]);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, [printing]);
  if (!origin)
    return <p>Connect to a private LAN to generate a printable QR code.</p>;
  if (!url) return <p>Enter a QR token to generate its code.</p>;
  if (result.url !== url) return <p role="status">Generating QR code…</p>;
  if (result.error)
    return (
      <p role="alert">
        Could not generate the QR code. Edit the token to try again.
      </p>
    );
  return (
    <div>
      <img
        src={result.image}
        width={320}
        height={320}
        style={{ maxWidth: "100%", height: "auto" }}
        alt="QR code for this challenge"
      />
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setPrinting(true)}
        >
          Print QR code
        </Button>
      </div>
      {printing &&
        createPortal(
          <div className="token-print-sheet">
            <img
              src={result.image}
              width={320}
              height={320}
              alt="QR code for this challenge"
              onLoad={() => window.print()}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
