// Har user ka apna rang — map par hex dekhte hi pata chale territory kis ki hai.
// Rao ka rang green hi rakha hai (pehle wala), baqi test users ko alag rang.
const FIXED: Record<string, string> = {
  Rao: "#22c55e",
  "Ayesha Khan": "#ef4444",
  "Bilal Ahmed": "#3b82f6",
  "Fatima Noor": "#f97316",
  "Usman Tariq": "#a855f7",
};

const PALETTE = [
  "#22c55e",
  "#ef4444",
  "#3b82f6",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#ec4899",
];

export function colorForUser(displayName: string): string {
  if (FIXED[displayName]) return FIXED[displayName];
  let h = 0;
  for (let i = 0; i < displayName.length; i++) {
    h = (h * 31 + displayName.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}
