import { useColorScheme } from "react-native";

/**
 * Everyday's Lifeline palette, the same tokens as the website: warm paper, near-black ink, and three status colours
 * (vermilion "needs you", moss "settled", ochre "waiting on PayPal"), plus red for "stopped".
 */
const light = {
  paper: "#f7f4ee",
  card: "#fffdf9",
  sunk: "#efeae0",
  ink: "#1c1a17",
  ink2: "#5a554c",
  ink3: "#8a8377",
  rule: "#e3ddd1",
  rule2: "#d3ccbe",
  now: "#b13a0d",
  nowBg: "#fbe9df",
  done: "#2c6a4d",
  doneBg: "#e3f0e8",
  wait: "#7d5800",
  waitBg: "#f8edd2",
  stop: "#a11d2b",
  stopBg: "#f9e3e5",
  paypal: "#ffc439",
  paypalInk: "#111111",
};
export type Palette = typeof light;
const dark: Palette = {
  paper: "#14120f",
  card: "#1d1a16",
  sunk: "#26221d",
  ink: "#f1ebe0",
  ink2: "#b5ac9c",
  ink3: "#8c8476",
  rule: "#36312a",
  rule2: "#4a443b",
  now: "#f48a57",
  nowBg: "#3a2016",
  done: "#79c79d",
  doneBg: "#16301f",
  wait: "#e4b850",
  waitBg: "#33280f",
  stop: "#f28b8b",
  stopBg: "#3a1a1d",
  paypal: "#ffc439",
  paypalInk: "#111111",
};

export const fonts = {
  display: "Newsreader_500Medium",
  sans: "PublicSans_400Regular",
  sansMedium: "PublicSans_500Medium",
  sansBold: "PublicSans_600SemiBold",
};

export function useTheme() {
  const scheme = useColorScheme();
  return { c: scheme === "dark" ? dark : light, dark: scheme === "dark" };
}
