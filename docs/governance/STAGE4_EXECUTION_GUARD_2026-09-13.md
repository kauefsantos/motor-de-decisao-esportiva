# Guard de execução Stage 4

O dispatcher cria um `jobId` e um `dispatchToken` aleatório. O endpoint só executa se o job puder ser reivindicado atomicamente em estado `QUEUED`; repetição do mesmo payload não inicia uma segunda validação.

A função de dispatch também reutiliza um job `QUEUED`/`RUNNING` existente, evitando duas execuções concorrentes para o mesmo artefato de escanteios.
