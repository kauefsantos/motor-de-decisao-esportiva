# E2E do fluxo quantitativo atual no ambiente Lovable/local autenticado.
# Percorre upload -> pipeline -> cotação -> resultado. A odd 2.00 é somente de teste
# quando houver um campo manual disponível.

import asyncio
import os
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = os.getenv("BASE_URL", "http://localhost:8080").rstrip("/")
CSV = """Data;Partida,Horário,Campeonato
07/09/2026;Vitória x Grêmio,20:00,Brasileirão Série A
"""

failures: list[str] = []


def check(condition: bool, label: str) -> None:
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures.append(label)


async def main() -> int:
    csv_path = Path(tempfile.gettempdir()) / "bve-experimental-e2e.csv"
    csv_path.write_text(CSV, encoding="utf-8")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1600})
        page = await context.new_page()
        page_errors: list[str] = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector(
            '[data-testid="upload-screen"][data-hydrated="true"]', timeout=60000
        )
        await page.set_input_files('[data-testid="csv-input"]', str(csv_path))
        process = page.get_by_test_id("processar-jogos")
        await process.wait_for(state="visible", timeout=20000)
        check(await process.is_enabled(), "CSV diário válido habilita COMEÇAR ANÁLISE")
        await process.click()

        await page.wait_for_url("**/oportunidades", timeout=240000)
        await page.get_by_text("Cotação em etapas", exact=True).wait_for(timeout=90000)
        body = await page.locator("body").inner_text()
        check("Vitória x Grêmio" in body, "partida resolvida aparece na cotação")
        check("Não foi possível preparar as opções" not in body, "preparação não terminou em erro técnico")

        inputs = page.locator('input[aria-label^="Odd bet365 para"]')
        count = await inputs.count()
        if count > 0:
            await inputs.first.fill("2.00")
            check(True, "há odd manual para preencher")
        else:
            check("Odds encontradas automaticamente" in body, "sem campo manual, há odds automáticas visíveis")

        analyze = page.get_by_role("button", name="ANALISAR ODDS DISPONÍVEIS")
        await analyze.wait_for(state="visible", timeout=30000)
        await analyze.click()
        await page.wait_for_url("**/resultado?mode=experimental", timeout=60000)
        result_body = await page.locator("body").inner_text()
        check("Sugestões do dia" in result_body, "análise redireciona para o resultado")
        check(
            "Modelo em validação" in result_body or "Resultado recuperado" in result_body,
            "status do modelo continua explícito no resultado",
        )
        check(not page_errors, f"sem erros de runtime no navegador ({page_errors[:1]})")
        await browser.close()

    print("\n%d verificações falharam" % len(failures) if failures else "\nTodas as verificações passaram")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
