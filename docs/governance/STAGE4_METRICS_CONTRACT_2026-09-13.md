# Contrato de métricas Stage 4

Para o artefato alvo, o relatório registra MAE, Brier Score, Log Loss, buckets de calibração, gap máximo de calibração e ECE, todos fora da amostra por walk-forward.

O baseline é a média histórica da própria competição na janela de treino, convertida para Poisson na avaliação probabilística do total de escanteios 9.5.

A comparação é feita sobre a mesma sequência temporal de partidas; odds não participam das features nem da métrica preditiva.
