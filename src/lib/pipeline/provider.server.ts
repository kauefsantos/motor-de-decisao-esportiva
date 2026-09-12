export type FootballProviderId = "five_dollar" | "api_sports";

export function activeFootballProvider(): FootballProviderId {
  const explicit = process.env["FOOTBALL_API_PROVIDER"]?.trim();
  if (explicit === "api_sports") return "api_sports";
  if (explicit === "five_dollar") return "five_dollar";
  if (process.env["FIVE_DOLLAR_FOOTBALL_API_KEY"]?.trim()) return "five_dollar";
  if (process.env["API_FOOTBALL_KEY"]?.trim()) return "api_sports";
  return "five_dollar";
}
