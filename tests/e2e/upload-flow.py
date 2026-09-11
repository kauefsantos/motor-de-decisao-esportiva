# Teste automatizado do caminho principal:
# upload válido -> COMEÇAR ANÁLISE -> pipeline -> conferência de odds.
#
# Executar com o dev server ativo e uma sessão autorizada disponível:
#   python3 tests/e2e/upload-flow.py
#
# O teste não valida números do modelo. Ele verifica navegação, estado final
# coerente e ausência de erro de runtime no navegador.

import asyncio
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = "http://localhost:8080"

CSV = """Data;Partida,Horário,Campeonato
08/09/2026;Cagliari x Lecce,13:30,Serie A
08/09/2026;Getafe x Celta de Vigo,14:00,LaLiga
08/09/2026;Nantes x Nancy,15:45,Ligue 2
08/09/2026;Udinese x Lazio,15:45,Serie A
08/09/2026;Elche x Real Sociedad,16:30,LaLiga
08/09/2026;Vitória x Grêmio,20:00,Brasileirão Série A
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
        await page.wait_for_selector('[data-testid="upload-screen"][data-hydrated="true"]', timeout=30000)

        await page.set_input_files('[data-testid="csv-input"]', str(csv_path))

        button = page.get_by_test_id("processar-jogos")
        await button.wait_for(state="visible", timeout=15000)
        check(await button.is_enabled(), "botão COMEÇAR ANÁLISE habilitado após CSV válido")

        summary = await page.locator('[data-testid="upload-screen"]').inner_text()
        check("6" in summary, "6 partidas válidas reconhecidas no CSV")
        check("08/09/2026" in summary, "data da rodada reconhecida a partir do CSV")

        await button.click()
        await page.wait_for_url("**/processamento", timeout=30000)
        check("/processamento" in page.url, "run criado e navegação para a tela de processamento")

        await page.wait_for_url("**/oportunidades", timeout=180000)
        await page.get_by_text("Conferir odds", exact=True).wait_for(timeout=60000)
        await page.get_by_text("Conferência das informações", exact=True).wait_for(timeout=60000)
        await page.wait_for_timeout(3000)
        body = await page.locator("body").inner_text()

        check("/oportunidades" in page.url, "pipeline concluído sem travar em loading")
        check(
            "Cotação em etapas" in body or "Nenhuma linha pôde ser modelada" in body,
            "tela de conferência de odds em estado final coerente",
        )
        check(
            "Não foi possível preparar as opções" not in body,
            "falha técnica não foi confundida com estado vazio",
        )
        check(not errors, f"sem erros de runtime no navegador ({errors[:1]})")

        await browser.close()

    print("\n%d verificações falharam" % len(failures) if failures else "\nTodas as verificações passaram")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
