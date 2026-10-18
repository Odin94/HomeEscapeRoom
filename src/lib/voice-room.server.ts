import { randomUUID } from "node:crypto";

type Entry = { id: string; text: string; created: number; claimed: boolean };
type Room = { device: string; until: number; muted: boolean; entries: Entry[] };
// Deliberately volatile: restart discards uncertain playback instead of replaying it.
const rooms = new Map<string, Room>();
export function roomCommand(
  session: string,
  device: string,
  command: string,
  text?: string,
) {
  const now = Date.now();
  for (const [id, room] of rooms)
    if (room.until < now - 60000) rooms.delete(id);
  let room = rooms.get(session);
  if (command === "clear") {
    rooms.delete(session);
    return {};
  }
  if (command === "claim") {
    if (room && room.until > now && room.device !== device)
      throw new Error(
        "Another room player owns the lease. Stop it or wait 20 seconds.",
      );
    if (!room && rooms.size >= 100) throw new Error("Too many room players.");
    if (!room) {
      room = { device, until: 0, muted: false, entries: [] };
      rooms.set(session, room);
    }
    room.device = device;
    room.until = now + 20000;
    return {
      device,
      muted: room.muted,
      entries: room.entries.map(({ id, claimed }) => ({ id, claimed })),
    };
  }
  if (!room || room.until <= now)
    throw new Error("Open and enable the room player first.");
  room.entries = room.entries.filter((entry) => now - entry.created < 60000);
  if (command === "enqueue") {
    if (room.muted) throw new Error("Room player is muted.");
    if (!text || text.length > 2500 || room.entries.length >= 10)
      throw new Error("Room queue is full or passage too long.");
    const entry = { id: randomUUID(), text, created: now, claimed: false };
    room.entries.push(entry);
    return { id: entry.id };
  }
  if (device !== room.device)
    throw new Error("This device does not own room playback.");
  if (command === "mute" || command === "stop") {
    room.entries = [];
    room.muted = command === "mute" ? !room.muted : room.muted;
    return { muted: room.muted };
  }
  if (command === "next") {
    if (room.muted) return {};
    const entry = room.entries.find((e) => !e.claimed);
    if (!entry) return {};
    entry.claimed = true; // At most one delivery; failed/uncertain playback requires intentional replay.
    return { id: entry.id, text: entry.text };
  }
  if (command === "valid") {
    if (
      room.muted ||
      !room.entries.some((entry) => entry.id === text && entry.claimed)
    )
      throw new Error("Announcement was stopped or expired.");
    return {};
  }
  if (command === "ack") {
    room.entries = room.entries.filter((e) => e.id !== text);
    return {};
  }
  throw new Error("Unknown room command.");
}
