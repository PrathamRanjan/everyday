/**
 * B: code words the server sends as codes ("monitor_arm", "price_drop") and the pages show with words(). Listing them
 * here puts them in the dictionaries; words() translates them. The codes themselves never change.
 */
import { N_ } from "@/i18n";

export const CODE_WORDS = [
  // Categories.
  N_("chair"), N_("desk mat"), N_("dock"), N_("headphones"), N_("keyboard"), N_("lamp"), N_("monitor"), N_("monitor arm"), N_("mouse"), N_("webcam"),
  // PayPal steps on an order.
  N_("order"), N_("capture"), N_("refund"), N_("authorize"), N_("void"),
  // Case issues and remedies.
  N_("price drop"), N_("damaged"), N_("defective"), N_("change of mind"), N_("not as described"), N_("wrong item"), N_("late"), N_("missing"), N_("replacement"), N_("repair"), N_("return"), N_("keep it"),
  // Choice reasons and shipping.
  N_("too expensive"), N_("already own"), N_("not needed"), N_("style"), N_("price"), N_("quality"), N_("wrong recipient"), N_("standard"), N_("express"),
  // Statuses.
  N_("succeeded"), N_("failed"), N_("pending"), N_("open"), N_("closed"), N_("refunded"), N_("approved"), N_("declined"), N_("expired"), N_("planning"), N_("purchased"), N_("shipped"), N_("delivered"),
];
