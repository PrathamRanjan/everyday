import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { getItem, setItem } from "./storage";

/**
 * Local reminders, scheduled on the phone (no push server): the morning a return window or a price promise is about
 * to close, and the day a delivery is due. Rebuilt from the server's dates each time Today loads, so they follow
 * the shopper's real dates. Off until the shopper turns them on.
 */
export type Dated = { id: string; title: string; date: string; kind: "return" | "warranty" | "delivery" | "deadline" };
const K = "everyday.reminders";

export const remindersSupported = Platform.OS !== "web";

export async function remindersOn() {
  return (await getItem(K)) === "1";
}

export async function setReminders(on: boolean, items: Dated[] = []): Promise<{ on: boolean; scheduled: number; message?: string }> {
  if (!remindersSupported) return { on: false, scheduled: 0, message: "Reminders work in the phone app, not in the browser build." };
  if (!on) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await setItem(K, "0");
    return { on: false, scheduled: 0 };
  }
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return { on: false, scheduled: 0, message: "Notifications are off for Everyday in Settings." };
  await setItem(K, "1");
  return { on: true, scheduled: await schedule(items) };
}

const LEAD: Record<Dated["kind"], number> = { return: 2, warranty: 7, delivery: 0, deadline: 1 };
const LINE: Record<Dated["kind"], (t: string) => string> = {
  return: (t) => `The return window for ${t} closes soon.`,
  warranty: (t) => `The warranty on ${t} ends in a week. Check it still works as it should.`,
  delivery: (t) => `${t} is due today.`,
  deadline: (t) => `Tomorrow is the day you needed ${t} by.`,
};

/** Replaces every scheduled reminder with these. Real calendar dates; 9am local time. */
export async function schedule(items: Dated[]): Promise<number> {
  if (!remindersSupported) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  let n = 0;
  for (const it of items.slice(0, 40)) {
    const at = new Date(`${it.date.slice(0, 10)}T09:00:00`);
    at.setDate(at.getDate() - LEAD[it.kind]);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000) continue;
    await Notifications.scheduleNotificationAsync({
      content: { title: "Everyday", body: LINE[it.kind](it.title), data: { kind: it.kind, id: it.id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
    n++;
  }
  return n;
}
