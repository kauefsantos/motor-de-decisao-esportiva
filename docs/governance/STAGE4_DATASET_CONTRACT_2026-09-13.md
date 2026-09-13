# Contrato do dataset Stage 4

Cada amostra de escanteios representa exatamente um `fixtureId` canônico.

Campos mínimos:

- fixture id;
- data da partida;
- chave da competição;
- IDs oficiais de mandante e visitante;
- escanteios realizados de cada lado.

Fixtures conflitantes ou incompletos são excluídos antes do validador. O algoritmo usa somente partidas com data estritamente anterior à partida-alvo e limita o treino aos 365 dias anteriores.
