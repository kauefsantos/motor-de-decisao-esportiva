# Escopo fechado — Etapa 4 / escanteios domésticos

Incluído neste PR:

- inventário das versões reais `corners-negbin-v2+nb2` e `corners-negbin-v2+poisson`;
- dataset canônico server-only;
- walk-forward temporal de 365 dias com paridade ao runtime;
- métricas OOS e estabilidade por liga;
- job privado para execução real no Lovable Cloud;
- persistência somente de `out_of_sample_metrics`;
- regressões contra leakage e promoção automática.

Fora deste PR:

- calibração (Platt/isotonic/outra); 
- `calibration_version`;
- promoção para `PRODUCTION_VALIDATED`;
- gols/1X2/BTTS;
- cartões, devido à incompatibilidade de settlement já documentada;
- modelos cross-league/continentais;
- qualquer alteração nas regras 70% / odd 1,70 / EV 8% / edge 5 p.p. / máximo 3.
