// TEST FIXTURES — payloads sintéticos usados EXCLUSIVAMENTE nos testes de parsing.
// Nunca importe este arquivo em rotas, componentes ou no pipeline: estes números
// não são dados reais e jamais devem alimentar a UI de produção.

export const TEST_FIXTURE_SCHEDULED_EVENTS = {
  __testFixture: true,
  events: [
    {
      id: 100001,
      startTimestamp: 1757176200, // 2025-09-06T16:30:00Z
      status: { type: "notstarted" },
      tournament: {
        name: "Serie A",
        uniqueTournament: { name: "Serie A" },
        category: { name: "Italy" },
      },
      homeTeam: { id: 5001, name: "Cagliari" },
      awayTeam: { id: 5002, name: "Lecce" },
    },
    {
      id: 100002,
      startTimestamp: 1757176200,
      status: { type: "notstarted" },
      tournament: {
        name: "Serie A",
        uniqueTournament: { name: "Serie A" },
        category: { name: "Italy" },
      },
      homeTeam: { id: 5003, name: "Cagliari Primavera" },
      awayTeam: { id: 5004, name: "Lecce Primavera" },
    },
    {
      id: 100003,
      startTimestamp: 1757194200,
      status: { type: "notstarted" },
      tournament: {
        name: "LaLiga",
        uniqueTournament: { name: "LaLiga" },
        category: { name: "Spain" },
      },
      homeTeam: { id: 5005, name: "Getafe CF" },
      awayTeam: { id: 5006, name: "RC Celta de Vigo" },
    },
  ],
};

export const TEST_FIXTURE_FINISHED_EVENTS = {
  __testFixture: true,
  events: [
    {
      id: 200001,
      startTimestamp: 1756404000,
      status: { type: "finished" },
      tournament: { uniqueTournament: { name: "Serie A" }, category: { name: "Italy" } },
      homeTeam: { id: 5001, name: "Cagliari" },
      awayTeam: { id: 5007, name: "Torino" },
      homeScore: { current: 2 },
      awayScore: { current: 1 },
    },
  ],
};

export const TEST_FIXTURE_EVENT_STATISTICS = {
  __testFixture: true,
  statistics: [
    {
      period: "ALL",
      groups: [
        {
          groupName: "Match overview",
          statisticsItems: [
            { name: "Corner kicks", home: "6", away: "3", homeValue: 6, awayValue: 3 },
            { name: "Total shots", home: "14", away: "9", homeValue: 14, awayValue: 9 },
            { name: "Shots on target", home: "5", away: "2", homeValue: 5, awayValue: 2 },
            { name: "Yellow cards", home: "2", away: "4", homeValue: 2, awayValue: 4 },
            { name: "Ball possession", home: "58%", away: "42%", homeValue: 58, awayValue: 42 },
          ],
        },
      ],
    },
    {
      period: "1ST",
      groups: [
        {
          groupName: "Match overview",
          statisticsItems: [
            { name: "Corner kicks", home: "3", away: "1", homeValue: 3, awayValue: 1 },
          ],
        },
      ],
    },
  ],
};
