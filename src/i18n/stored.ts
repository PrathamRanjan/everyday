/**
 * B3.3: sentences the server stores in the database (seed rows, labels written by SQL) or builds inside small helpers
 * the harvester can't see. Listing them here puts them in the dictionaries; they are re-worded on the way out like
 * every other stored sentence. Nothing here is compared in code.
 */
import { N_ } from "./index.js";

export const STORED_SENTENCES = [
  // Merchant label and order sources (seed.ts, orders.ts, life.ts).
  N_("Buy here with PayPal"),
  N_("Paid from the demo's saved sandbox wallet"),
  N_("added by hand"),
  N_("added by {0}"),
  N_("receipt import"),
  N_("Everyday order"),
  // Pick reasons (plans.ts, prefs.ts).
  N_("{0}, as you asked"),
  N_("you tend to like {0}"),
  N_("most shoppers like {0} (your own choices will tune this)"),
  N_("good value for its price"),
  N_("exact match for the item in your clip"),
  N_("you leaned toward lower prices"),
  N_("you were happy to spend more for quality"),
  N_("more weight on {0}"),
  N_("less weight on {0}"),
  // Qualities a request can name (catalog-data.ts), shown inside the reasons above.
  ...[N_("wood"), N_("black"), N_("white"), N_("silver"), N_("grey"), N_("colour"), N_("brass"), N_("metal"), N_("mesh"), N_("fabric"), N_("plastic")],
  ...[N_("minimal"), N_("warm"), N_("industrial"), N_("playful"), N_("ergonomic"), N_("compact"), N_("premium"), N_("quiet")],
  // Case issues, shown inside case sentences (money-back.ts).
  ...[N_("price drop"), N_("damaged"), N_("defective"), N_("change of mind"), N_("late"), N_("missing")],
];
