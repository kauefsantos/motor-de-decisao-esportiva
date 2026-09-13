# Regra de segurança — nenhuma promoção automática na Etapa 4

O resultado de uma validação quantitativa, inclusive `READY_FOR_CALIBRATION`, não altera automaticamente `model_versions.validation_status` nem `model_versions.calibration_version`.

Motivo: o gate operacional exige artefato exato de modelo + calibração. A validação da probabilidade bruta é apenas uma etapa anterior.

Portanto:

- `VALIDATION_FAILED` mantém bloqueio;
- `INSUFFICIENT_OOS_DATA` mantém bloqueio;
- `READY_FOR_CALIBRATION` mantém bloqueio e apenas autoriza a construção de um calibrador OOS;
- `PRODUCTION_VALIDATED` só poderá existir em pacote posterior, com evidência do modelo exato, calibrador imutável e testes do gate de produção.
