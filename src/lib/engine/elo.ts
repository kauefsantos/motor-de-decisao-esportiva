// Elo v1 — força relativa determinística, sem odds como feature.
// O rating armazenado é neutro; o mando entra apenas na expectativa usada para
// atualizar o Elo após partidas encerradas. O ajuste dos lambdas preserva a
// expectativa total de gols e só redistribui a participação entre os times.

export const ELO_VERSION = "elo-v1";
export const ELO_INITIAL_RATING = 1500;
export const ELO_K = 20;
export const ELO_DEFAULT_HOME_ADVANTAGE = 60;
export const ELO_GOAL_SHARE_WEIGHT = 0.2;
export