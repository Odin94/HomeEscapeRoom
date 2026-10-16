import { openStore } from "../src/lib/store.server";
const db = openStore(process.env.DATABASE_PATH || "data/threshold.sqlite");
db.$client.close();
console.log("SQLite migrations applied.");
