/**
 * Authored demo catalog. Northlight Supply is a clearly identified sandbox test merchant; Lumen & Oak and the
 * unverified listing are discovery-only. Prices are demo inputs, not live retailer prices.
 */
export interface Attrs {
  finish?: "wood" | "black" | "white" | "silver" | "grey" | "colour" | "brass";
  material?: "wood" | "metal" | "mesh" | "fabric" | "plastic";
  style: string[]; // minimal, warm, industrial, playful, ergonomic, compact, premium, quiet
  host?: ("usb-c-dp" | "thunderbolt" | "usb-a")[]; // dock/adaptor: laptop ports it works with
  video_out?: ("hdmi" | "dp")[];
  pd_watts?: number;
  inputs?: ("hdmi" | "dp" | "usb-c")[]; // monitors
  vesa_mount?: number; // monitor's mount
  vesa?: number[]; // arms: mounts supported
  ergonomic?: boolean; // chairs: lumbar + adjustable
  wireless?: boolean;
}

export interface ProductDef {
  sku: string;
  title: string;
  brand: string;
  model: string;
  category: "lamp" | "chair" | "dock" | "mouse" | "keyboard" | "monitor" | "monitor_arm" | "desk_mat" | "webcam" | "headphones";
  price: number; // dollars
  stock: number;
  attrs: Attrs;
  description: string;
  warranty_months?: number;
}

export const NORTHLIGHT: ProductDef[] = [
  { sku: "NL-LAMP-HALDEN-OAK", title: "Halden LED Desk Lamp, Oak", brand: "Halden", model: "HL-200 Oak", category: "lamp", price: 49, stock: 14, attrs: { finish: "wood", material: "wood", style: ["minimal", "warm"] }, description: "Dimmable warm-white LED lamp with an oak arm and weighted base", warranty_months: 24 },
  { sku: "NL-LAMP-HALDEN-BLK", title: "Halden LED Desk Lamp, Black", brand: "Halden", model: "HL-200 Black", category: "lamp", price: 49, stock: 9, attrs: { finish: "black", material: "metal", style: ["minimal"] }, description: "Dimmable LED lamp, matte black steel arm", warranty_months: 24 },
  { sku: "NL-LAMP-BRITE", title: "Brite Clamp Lamp", brand: "Brite", model: "BC-1", category: "lamp", price: 29, stock: 30, attrs: { finish: "white", material: "plastic", style: ["compact"] }, description: "Clamp-on LED lamp for small desks", warranty_months: 12 },
  { sku: "NL-LAMP-ORBIT", title: "Orbit Arc Lamp, Brass", brand: "Orbit", model: "OA-3", category: "lamp", price: 89, stock: 6, attrs: { finish: "brass", material: "metal", style: ["premium", "warm"] }, description: "Brass arc desk lamp with fabric shade", warranty_months: 24 },
  { sku: "NL-LAMP-PIXEL", title: "Pixel RGB Lamp", brand: "Pixel", model: "PX-RGB", category: "lamp", price: 39, stock: 20, attrs: { finish: "colour", material: "plastic", style: ["playful"] }, description: "Colour-changing RGB desk light", warranty_months: 12 },
  { sku: "NL-LAMP-TILT", title: "Tilt Task Lamp, Grey", brand: "Tilt", model: "TT-5", category: "lamp", price: 35, stock: 18, attrs: { finish: "grey", material: "metal", style: ["industrial"] }, description: "Industrial grey task lamp with a hinged head", warranty_months: 12 },
  { sku: "NL-CHAIR-ERGO", title: "Ergo Mesh Chair", brand: "Ergo", model: "EM-500", category: "chair", price: 189, stock: 5, attrs: { finish: "black", material: "mesh", style: ["ergonomic", "premium"], ergonomic: true }, description: "Mesh office chair with adjustable lumbar support and 4D armrests", warranty_months: 36 },
  { sku: "NL-CHAIR-ERGO-LITE", title: "Ergo Mesh Chair Lite", brand: "Ergo", model: "EM-300", category: "chair", price: 169, stock: 8, attrs: { finish: "black", material: "mesh", style: ["ergonomic", "compact"], ergonomic: true }, description: "Mesh chair with adjustable lumbar support, 2D armrests", warranty_months: 24 },
  { sku: "NL-CHAIR-NORDIC", title: "Nordic Wood Chair", brand: "Nordic", model: "NW-1", category: "chair", price: 149, stock: 7, attrs: { finish: "wood", material: "wood", style: ["warm", "minimal"], ergonomic: false }, description: "Beech desk chair with a linen seat pad (no lumbar adjustment)", warranty_months: 12 },
  { sku: "NL-CHAIR-BASIC", title: "Task Chair Basic", brand: "Northlight", model: "TC-10", category: "chair", price: 79, stock: 25, attrs: { finish: "black", material: "fabric", style: ["compact"], ergonomic: false }, description: "Basic fabric task chair", warranty_months: 12 },
  { sku: "NL-CHAIR-AERO", title: "Aero Pro Chair", brand: "Aero", model: "AP-9", category: "chair", price: 329, stock: 3, attrs: { finish: "grey", material: "mesh", style: ["ergonomic", "premium"], ergonomic: true }, description: "Premium ergonomic mesh chair with headrest", warranty_months: 60 },
  { sku: "NL-STOOL-SADDLE", title: "Saddle Stool, Oak", brand: "Nordic", model: "SS-2", category: "chair", price: 99, stock: 4, attrs: { finish: "wood", material: "wood", style: ["minimal", "compact"], ergonomic: false }, description: "Oak saddle stool", warranty_months: 12 },
  { sku: "NL-HUB-4IN1", title: "LinkHub 4-in-1 USB-C Hub", brand: "Link", model: "LH-4", category: "dock", price: 19, stock: 40, attrs: { style: ["compact"], host: ["usb-c-dp", "thunderbolt"], video_out: [], pd_watts: 0 }, description: "USB-C hub with 3 USB-A ports and SD reader; no video output", warranty_months: 12 },
  { sku: "NL-DOCK-7IN1", title: "LinkDock USB-C 7-in-1 (HDMI 4K60, PD 100W)", brand: "Link", model: "LD-7", category: "dock", price: 59, stock: 22, attrs: { style: ["compact"], host: ["usb-c-dp", "thunderbolt"], video_out: ["hdmi"], pd_watts: 100 }, description: "USB-C dock with HDMI 4K60, 100 W passthrough charging, Ethernet", warranty_months: 24 },
  { sku: "NL-DOCK-PRO", title: "LinkDock Pro USB-C (HDMI + DisplayPort)", brand: "Link", model: "LD-PRO", category: "dock", price: 89, stock: 10, attrs: { style: ["premium"], host: ["usb-c-dp", "thunderbolt"], video_out: ["hdmi", "dp"], pd_watts: 100 }, description: "USB-C dock with HDMI and DisplayPort outputs", warranty_months: 24 },
  { sku: "NL-DOCK-TB4", title: "Bolt Thunderbolt 4 Dock", brand: "Bolt", model: "BT4", category: "dock", price: 189, stock: 5, attrs: { style: ["premium"], host: ["thunderbolt"], video_out: ["hdmi", "dp"], pd_watts: 96 }, description: "Thunderbolt 4 dock (requires a Thunderbolt port)", warranty_months: 24 },
  { sku: "NL-ADAPT-USBA", title: "USB-A Display Adapter (HDMI)", brand: "Link", model: "LA-1", category: "dock", price: 69, stock: 8, attrs: { style: ["compact"], host: ["usb-a"], video_out: ["hdmi"], pd_watts: 0 }, description: "DisplayLink USB-A to HDMI adapter for laptops without video-capable USB-C", warranty_months: 12 },
  { sku: "NL-MOUSE-GLIDE", title: "Glide Wireless Mouse", brand: "Glide", model: "GM-2", category: "mouse", price: 29, stock: 30, attrs: { finish: "black", material: "plastic", style: ["minimal"], wireless: true }, description: "Slim wireless mouse", warranty_months: 12 },
  { sku: "NL-MOUSE-VERT", title: "Ergo Vertical Mouse", brand: "Ergo", model: "EV-1", category: "mouse", price: 39, stock: 15, attrs: { finish: "black", material: "plastic", style: ["ergonomic"], wireless: true }, description: "Vertical wireless mouse for wrist comfort", warranty_months: 12 },
  { sku: "NL-MOUSE-BASIC", title: "Click Basic Mouse", brand: "Northlight", model: "CB-1", category: "mouse", price: 12, stock: 50, attrs: { finish: "black", material: "plastic", style: ["compact"], wireless: false }, description: "Wired USB mouse", warranty_months: 6 },
  { sku: "NL-MOUSE-OAK", title: "Silent Mouse, Oak", brand: "Halden", model: "SM-Oak", category: "mouse", price: 35, stock: 12, attrs: { finish: "wood", material: "wood", style: ["warm", "quiet", "minimal"], wireless: true }, description: "Silent-click wireless mouse with an oak top", warranty_months: 12 },
  { sku: "NL-KB-QUIET", title: "Quiet Keys Wireless Keyboard", brand: "Quiet", model: "QK-2", category: "keyboard", price: 49, stock: 20, attrs: { finish: "grey", material: "plastic", style: ["quiet", "minimal"], wireless: true }, description: "Low-profile quiet wireless keyboard", warranty_months: 12 },
  { sku: "NL-KB-RETRO", title: "Retro Mech Keyboard", brand: "Retro", model: "RM-87", category: "keyboard", price: 89, stock: 9, attrs: { finish: "colour", material: "plastic", style: ["playful"], wireless: false }, description: "Mechanical keyboard with round retro keycaps", warranty_months: 12 },
  { sku: "NL-KB-SLIM", title: "Slim Keys", brand: "Northlight", model: "SK-1", category: "keyboard", price: 29, stock: 30, attrs: { finish: "black", material: "plastic", style: ["compact"], wireless: false }, description: "Compact wired keyboard", warranty_months: 12 },
  { sku: "NL-KB-OAK", title: "Oak Keys Wireless", brand: "Halden", model: "OK-1", category: "keyboard", price: 79, stock: 6, attrs: { finish: "wood", material: "wood", style: ["warm", "quiet", "premium"], wireless: true }, description: "Wireless keyboard in an oak frame", warranty_months: 24 },
  { sku: "NL-MON-P2422H", title: "Dell P2422H 24\" Monitor", brand: "Dell", model: "P2422H", category: "monitor", price: 189, stock: 6, attrs: { finish: "black", material: "plastic", style: ["minimal"], inputs: ["hdmi", "dp"], vesa_mount: 100 }, description: "24-inch IPS monitor with HDMI and DisplayPort inputs, VESA 100", warranty_months: 36 },
  { sku: "NL-MON-VIEW27", title: "ViewMax 27\" USB-C Monitor", brand: "ViewMax", model: "VM27C", category: "monitor", price: 279, stock: 4, attrs: { finish: "silver", material: "metal", style: ["premium"], inputs: ["hdmi", "usb-c"], vesa_mount: 100 }, description: "27-inch QHD monitor with USB-C input", warranty_months: 36 },
  { sku: "NL-MON-BUDGET", title: "BudgetView 22\" Monitor", brand: "BudgetView", model: "BV22", category: "monitor", price: 99, stock: 12, attrs: { finish: "black", material: "plastic", style: ["compact"], inputs: ["hdmi"], vesa_mount: 75 }, description: "22-inch 1080p monitor, HDMI", warranty_months: 12 },
  { sku: "NL-ARM-LIFT", title: "Lift Monitor Arm, Single", brand: "Lift", model: "LA-S", category: "monitor_arm", price: 59, stock: 10, attrs: { finish: "black", material: "metal", style: ["minimal"], vesa: [75, 100] }, description: "Gas-spring arm, VESA 75/100, up to 8 kg", warranty_months: 24 },
  { sku: "NL-ARM-MINI", title: "Clamp Arm Mini", brand: "Lift", model: "CA-M", category: "monitor_arm", price: 39, stock: 10, attrs: { finish: "silver", material: "metal", style: ["compact"], vesa: [75] }, description: "Light clamp arm for VESA 75 monitors only", warranty_months: 12 },
  { sku: "NL-ARM-OAK", title: "Lift Arm, White Oak Edition", brand: "Lift", model: "LA-W", category: "monitor_arm", price: 79, stock: 5, attrs: { finish: "wood", material: "metal", style: ["warm", "premium"], vesa: [75, 100] }, description: "Monitor arm with white-oak trim, VESA 75/100", warranty_months: 24 },
  { sku: "NL-MAT-FELT", title: "Felt Desk Mat, Grey", brand: "Northlight", model: "DM-F", category: "desk_mat", price: 25, stock: 20, attrs: { finish: "grey", material: "fabric", style: ["minimal", "quiet"] }, description: "Wool felt desk mat 80×30 cm", warranty_months: 6 },
  { sku: "NL-MAT-CORK", title: "Cork Desk Mat", brand: "Halden", model: "DM-C", category: "desk_mat", price: 29, stock: 15, attrs: { finish: "wood", material: "wood", style: ["warm", "minimal"] }, description: "Natural cork desk mat 80×40 cm", warranty_months: 6 },
  { sku: "NL-CAM-HD", title: "ClearCam HD Webcam", brand: "Clear", model: "CC-1080", category: "webcam", price: 45, stock: 18, attrs: { finish: "black", material: "plastic", style: ["compact"] }, description: "1080p webcam with privacy shutter", warranty_months: 12 },
  { sku: "NL-HP-QUIET", title: "Hush ANC Headphones", brand: "Hush", model: "H-ANC", category: "headphones", price: 99, stock: 8, attrs: { finish: "grey", material: "fabric", style: ["quiet", "premium"], wireless: true }, description: "Noise-cancelling wireless headphones", warranty_months: 12 },
];

export const DISCOVERY: (ProductDef & { merchant: "lumen" | "unverified"; url: string })[] = [
  { merchant: "lumen", url: "https://lumenandoak.example/products/walnut-lamp", sku: "LO-LAMP-WALNUT", title: "Lumen & Oak Walnut Desk Lamp", brand: "Lumen & Oak", model: "W-12", category: "lamp", price: 119, stock: 1, attrs: { finish: "wood", material: "wood", style: ["warm", "premium", "minimal"] }, description: "Hand-turned walnut lamp" },
  { merchant: "lumen", url: "https://lumenandoak.example/products/linen-chair", sku: "LO-CHAIR-LINEN", title: "Lumen & Oak Linen Desk Chair", brand: "Lumen & Oak", model: "L-3", category: "chair", price: 249, stock: 1, attrs: { finish: "wood", material: "fabric", style: ["warm", "premium"], ergonomic: false }, description: "Linen and ash chair" },
  { merchant: "unverified", url: "https://marketplace.example/item/993", sku: "MK-DOCK-993", title: "Generic USB-C Dock 8-in-1", brand: "Generic", model: "993", category: "dock", price: 25, stock: 0, attrs: { style: ["compact"], host: ["usb-c-dp"], video_out: ["hdmi"] }, description: "Marketplace listing; availability unconfirmed" },
];

/** Seeded clips: scene objects are authored for the demo and labeled so in the app. */
export const CLIPS = [
  {
    url: "https://youtube.com/shorts/dSk7Setup01",
    title: "My cosy study desk setup",
    caption: "warm oak lamp, mesh chair, 24\" monitor and a little plant #desksetup",
    objects: [
      { key: "lamp", label: "Desk lamp (oak arm)", query: "oak led desk lamp", category: "lamp", match_sku: "NL-LAMP-HALDEN-OAK" },
      { key: "chair", label: "Mesh office chair", query: "mesh ergonomic chair", category: "chair", match_sku: null },
      { key: "monitor", label: "24-inch monitor", query: "24 inch monitor", category: "monitor", match_sku: "NL-MON-P2422H" },
      { key: "plant", label: "Small plant", query: "desk plant", category: null, match_sku: null },
    ],
  },
  { url: "https://www.instagram.com/reel/Cz9DeskReel/", title: "Minimal black desk tour", caption: "all black everything", objects: [{ key: "keyboard", label: "Low-profile keyboard", query: "quiet low profile keyboard", category: "keyboard", match_sku: "NL-KB-QUIET" }, { key: "mouse", label: "Wireless mouse", query: "wireless mouse", category: "mouse", match_sku: "NL-MOUSE-GLIDE" }] },
  { url: "https://www.tiktok.com/@deskdays/video/7300000000000000001", title: "Cable-free laptop setup", caption: "one cable to rule them all", objects: [{ key: "dock", label: "USB-C dock", query: "usb-c dock hdmi", category: "dock", match_sku: "NL-DOCK-7IN1" }] },
];

export const RECALLS = [
  { brand: "Hush", model: "H-ANC", title: "Hush ANC Headphones: battery may swell in units made before March 2026 (demo recall feed)", remedy: "Stop charging; free battery replacement from Hush", url: "https://recalls.example/hush-h-anc" },
  { brand: "Pixel", model: "PX-RGB", title: "Pixel RGB Lamp power adapter may overheat (demo recall feed)", remedy: "Free replacement adapter from Pixel", url: "https://recalls.example/pixel-px-rgb" },
];

/** Global feature space for the preference model. */
export const FINISHES = ["wood", "black", "white", "silver", "grey", "colour", "brass"] as const;
export const MATERIALS = ["wood", "metal", "mesh", "fabric", "plastic"] as const;
export const STYLES = ["minimal", "warm", "industrial", "playful", "ergonomic", "compact", "premium", "quiet"] as const;
