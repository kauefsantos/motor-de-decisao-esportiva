# E2E real do piloto experimental no ambiente Lovable.
# Usa uma partida coberta pela 5Dollar, percorre upload -> pipeline -> Motor 1 ->
# input de odd -> Motor 2 -> resultado final. A odd 2.00 é exclusivamente de teste.

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
        check(await process.is_enabled(), "CSV diário válido habilita PROCESSAR JOGOS")
        await process.click()

        await page.wait_for_url("**/oportunidades", timeout=240000)
        await page.get_by_text("Odds organizadas por jogo").wait_for(timeout=90000)
        body = await page.locator("body").inner_text()
        check("Vitória x Grêmio" in body, "partida resolvida aparece no piloto")
        check(
            "DOUBLE_CHANCE" in body and "Dupla chance" in body,
            "dupla chance é derivada e publicada no Motor 1 experimental",
        )
        check(
            "TEAM_GOALS" in body or "Gols Vitória" in body or "Gols Grêmio" in body,
            "mercados de gols por time chegam à tela quando passam o gate",
        )

        inputs = page.locator('input[aria-label^="Odd experimental para"]')
        count = await inputs.count()
        check(count > 0, "há ao menos uma odd experimental para preencher")
        if count > 0:
            # A odd é propositalmente artificial e serve apenas para validar o Motor 2.
            await inputs.first.fill("2.00")
            await page.get_by_role(
                "button", name="ANALISAR ODDS — PILOTO EXPERIMENTAL"
            ).click()
            await page.wait_for_url("**/resultado?mode=experimental", timeout=60000)
            result_body = await page.locator("body").inner_text()
            check(
                "Resultado final experimental" in result_body,
                "Motor 2 redireciona para o resultado experimental",
            )
            check(
                "Escolha experimental" in result_body,
                "Motor 2 produz ao menos uma seleção com odd de teste",
            )
            check(
                "NÃO VALIDADO PARA PRODUÇÃO" in result_body,
                "status experimental permanece separado da produção",
            )

        check(not page_errors, f"sem erros de runtime no navegador ({page_errors[:1]})")
        await browser.close()

    print("\n%d verificações falharam" % len(failures) if failures else "\nTodas as verificações passaram")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
