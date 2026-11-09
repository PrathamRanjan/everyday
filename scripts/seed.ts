/** Loads the demo (Maya, Northlight Supply, discovery listings, recall feed) and trains the preference prior. */
import { getDb } from "../src/db.js";
import { seed } from "../src/services/seed.js";
const db = await getDb();
const s = await db.tx((q) => seed(q));
console.log(`maya       ${s.keys.maya}\nnorthlight ${s.keys.northlight}`);
await db.close();
