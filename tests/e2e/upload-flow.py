# Teste automatizado do caminho principal:
# upload válido -> PROCESSAR JOGOS -> pipeline -> estado final honesto.
#
# Executar com o dev server ativo:  python3 tests/e2e/upload-flow.py
#
# O teste NÃO valida números de modelo: com adapters indisponíveis/não configurados
# e nenhum modelo validado out-of-sample, o resultado esperado é bloqueio explícito.

import asyncio
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = "http://localhost:8080"

CSV = """Partida,Horário,Campeonato
Cagliari x Lecce,13:30,Serie A
Getafe x Celta de Vigo,14:00,LaLiga
Nantes x Nancy,15:45,Ligue 2
Udinese x Lazio,15:45,Serie A
Elche x Real Sociedad,16:30,LaLiga
Vitória x Grêmio,20:00,Brasileirão Série A
"""

failures: list[str] = []


def check(condition: bool, label: str) -> None:
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures.append(label)


async def main() -> int:
    csv_path = Path(tempfile.gettempdir()) / "bve-main-path.csv"
    csv_path.write_text(CSV, encoding="utf-8")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(BASE_URL, wait_until="domcontentloaded")
        # Espera a hidratação antes de enviar o arquivo (evita race condition).
        await page.wait_for_selector('[data-testid="upload-screen"][data-hydrated="true"]', timeout=30000)

        await page.set_input_files('[data-testid="csv-input"]', str(csv_path))

        button = page.get_by_test_id("processar-jogos")
        await button.wait_for(state="visible", timeout=15000)
        check(await button.is_enabled(), "botão PROCESSAR JOGOS habilitado após CSV válido")

        summary = await page.locator('[data-testid="upload-screen"]').inner_text()
        check("6" in summary, "6 partidas válidas reconhecidas no CSV")

        await button.click()
        await page.wait_for_url("**/processamento", timeout=30000)
        check("/processamento" in page.url, "run criado e navegação para a tela de processamento")

        # O pipeline deve terminar: ou avança para oportunidades, ou expõe erro — nunca fica preso.
        await page.wait_for_url("**/oportunidades", timeout=180000)
        body = await page.locator("body").inner_text()

        check("/oportunidades" in page.url, "pipeline concluído sem travar em loading")
        check(
            "Nenhum contrato foi publicado" in body or "Mercado para observar" in body,
            "tela de oportunidades em estado final coerente",
        )
        check(
            "MODEL_NOT_PRODUCTION_VALIDATED" in body
            or "Nenhum contrato foi publicado" in body,
            "sem modelo validado, o motor bloqueia em vez de inventar probabilidade",
        )
        check("Auditoria da ingestão" in body, "auditoria por fonte exibida")
        check(not errors, f"sem erros de runtime no navegador ({errors[:1]})")

        await browser.close()

    print("\n%d verificações falharam" % len(failures) if failures else "\nTodas as verificações passaram")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
