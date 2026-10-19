import { z } from "zod";
import { settings } from "./settings.server";

const entitySchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.object({ friendly_name: z.string().optional() }),
});
const speechSchema = z.object({
  entity: z.string().regex(/^notify\.[a-z0-9_]+$/),
  message: z.string().trim().min(1).max(1000),
});
export async function ha(path: string, body?: unknown, signal?: AbortSignal) {
  const config = settings();
  if (!config.haUrl || !config.haToken)
    throw new Error(
      "Configure the Home Assistant URL and token in Settings first.",
    );
  let response: Response;
  try {
    response = await fetch(`${config.haUrl.replace(/\/$/, "")}/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${config.haToken}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(
      "Could not reach Home Assistant. Check the connection before retrying.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Home Assistant returned ${response.status}. Check your token, device and supported action.`,
    );
  return response;
}
export async function lightTargets(domains = "light|scene") {
  const response = await ha("states");
  return z
    .array(entitySchema)
    .parse(await response.json())
    .filter((e) => new RegExp(`^(${domains})\\.`).test(e.entity_id))
    .map((e) => ({
      entity: e.entity_id,
      name: e.attributes.friendly_name || e.entity_id,
      available: e.state !== "unavailable",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function speechTargets(signal?: AbortSignal) {
  const response = await ha("states", undefined, signal);
  const entities = z.array(entitySchema).parse(await response.json());
  return entities
    .filter((entity) => /^notify\..+_(speak|announce)$/.test(entity.entity_id))
    .map((entity) => ({
      entity: entity.entity_id,
      name: entity.attributes.friendly_name || entity.entity_id,
      // Notify entities can be "unknown" until their first notification.
      available: entity.state !== "unavailable",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function speak(value: unknown, signal?: AbortSignal) {
  const input = speechSchema.parse(value);
  const targets = await speechTargets(signal);
  signal?.throwIfAborted();
  const target = targets.find((item) => item.entity === input.entity);
  if (!target?.available)
    throw new Error(
      "Choose an available Speak or Announce speaker. Refresh speakers and try again.",
    );
  // Treat typed text literally rather than executing Alexa's SSML markup.
  const message = input.message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  await ha(
    "services/notify/send_message",
    {
      entity_id: input.entity,
      message,
    },
    signal,
  );
  return target;
}
