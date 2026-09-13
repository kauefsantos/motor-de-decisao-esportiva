# Etapa 4 — checklist operacional do pacote de escanteios

Este pacote só pode ser considerado concluído quando todos os itens abaixo forem verdadeiros.

- [ ] PR com todos os gates verdes, incluindo banco e browser/acessibilidade quando aplicável.
- [ ] Merge protegido pelo SHA do head aprovado.
- [ ] Migration exata aplicada no Lovable Cloud.
- [ ] Lovable sincronizado e publicado no mesmo commit do `main`.
- [ ] `kick_stage4_corners_validation()` disparado uma única vez.
- [ ] Job `stage4-model-validation` em `DONE` ou erro documentado.
- [ ] Relatório OOS real persistido em `corners-negbin-v2+nb2`.
- [ ] `validation_status` permanece `NOT_PRODUCTION_VALIDATED`.
- [ ] `calibration_version` permanece `null`.
- [ ] Resultado quantitativo classificado como `INSUFFICIENT_OOS_DATA`, `VALIDATION_FAILED` ou `READY_FOR_CALIBRATION`.
- [ ] Próxima ação escolhida a partir do resultado real, sem promoção manual.
