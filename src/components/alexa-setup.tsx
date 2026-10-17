import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui";

type Setup = {
  entity: string;
  name: string;
  testing: boolean;
  readyToTest: boolean;
  tested: boolean;
  received: boolean;
  error?: string;
  warning?: string;
};
export function AlexaSetup({
  sessionId,
  challengeId,
  answer,
}: {
  sessionId: string;
  challengeId: string;
  answer: string;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [phrase, setPhrase] = useState(answer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const request = useCallback(
    async (action: string) => {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: sessionId, challengeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Alexa setup failed.");
      return data.setup as Setup | null;
    },
    [sessionId, challengeId],
  );
  useEffect(() => {
    let active = true;
    let loading = false;
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        const value = await request("alexa-status");
        if (active) setSetup(value);
      } catch (error) {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load Alexa status.",
          );
      } finally {
        loading = false;
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [request]);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      const value = await request(action);
      setSetup(value);
      if (value?.warning) setWarning(value.warning);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Alexa setup failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset>
      <legend>Set up Alexa answer</legend>
      <p>
        The app creates a Home Assistant toggle and watches it while the game
        server is running. No YAML or callback tokens are needed.
      </p>
      <p>
        First connect Home Assistant to Alexa. Home Assistant Cloud (Nabu Casa,
        paid subscription) provides an existing Alexa skill you can enable; you
        do not need to build one. The alternative is creating your own Alexa
        Smart Home skill and AWS Lambda connection.{" "}
        <a
          href="https://www.home-assistant.io/integrations/alexa.smart_home/"
          target="_blank"
          rel="noreferrer"
        >
          Connection instructions
        </a>
        .
      </p>
      <Button
        type="button"
        disabled={busy || setup?.testing}
        onClick={() => void act("alexa-setup")}
      >
        {busy
          ? "Working…"
          : setup
            ? "Repair Home Assistant setup"
            : "Set up Home Assistant"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {warning && <p role="status">{warning}</p>}
      {setup && (
        <>
          <p>
            Helper: <strong>{setup.name}</strong> (<code>{setup.entity}</code>)
          </p>
          <ol>
            <li>
              Enable Alexa in Home Assistant Cloud, or use an Alexa Smart Home
              skill you have created and connected yourself. The Alexa Devices
              speaker integration alone does not provide this connection. For
              your own Smart Home skill, include this helper in its exposure
              settings.
            </li>
            <li>Ask Alexa to discover devices. Find the helper named above.</li>
            <li>
              In the Alexa app, open More → Routines → +. Choose Voice as the
              trigger and enter the phrase below without “Alexa”.
            </li>
            <li>
              Add a Smart Home action that turns this helper <strong>on</strong>
              , then save the routine.
            </li>
          </ol>
          <label>
            Voice phrase (for your Alexa routine)
            <input
              value={phrase}
              maxLength={256}
              onChange={(event) => setPhrase(event.target.value)}
            />
          </label>
          <p>
            Say: <strong>Alexa, {phrase || "your routine phrase"}</strong>.
          </p>
          <p>
            This routine submits the saved answer. It does not transcribe speech
            or judge incorrect guesses. Use a different helper and routine for
            each simultaneous team; do not assign the same phrase to multiple
            teams sharing an Echo.
          </p>
          <p>
            Add a speech action under the challenge’s When solved actions to
            hear confirmation during play.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || setup.testing}
            onClick={() => void act("alexa-test")}
          >
            Test Alexa routine without solving
          </Button>
          <p role="status">
            {setup.error ||
              (setup.testing
                ? setup.readyToTest
                  ? "Say the phrase now. Waiting up to 60 seconds; this test will not solve the challenge."
                  : "Preparing the test… wait before saying the phrase."
                : setup.tested
                  ? "Alexa signal received. Test passed; the challenge was not solved."
                  : setup.received
                    ? "Alexa answer received during play."
                    : "Home Assistant helper configured. Test the Alexa routine before playing.")}
          </p>
        </>
      )}
    </fieldset>
  );
}
