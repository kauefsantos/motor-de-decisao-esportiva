# Paridade com runtime — Stage 4 escanteios

O validador usa exatamente os mesmos componentes da inferência doméstica atual:

- `fitBaseline()`;
- `predict()`;
- `chooseCountDistribution()`;
- anchor 9.5 de `corners_match_total`;
- janela móvel de 365 dias;
- exclusão de partidas do mesmo dia da previsão.

A validação não reimplementa o modelo em SQL ou notebook; o cálculo é feito pelo código TypeScript da aplicação para reduzir divergência entre backtest e runtime.
