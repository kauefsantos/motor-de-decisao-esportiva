# Teste E2E reproduzível do research_adapter (Desk Research / Dados Públicos).
#
# Partidas reais de competições cobertas por datasets públicos e abertos.
# Executar com o dev server ativo:  python3 tests/e2e/research-adapter.py
#
# O teste valida a INGESTÃO (resolução, histórico pré-jogo, métricas, auditoria),
# não números de modelo: sem modelo validado o motor deve continuar bloqueando.

import asyncio
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = "http://localhost:8080"

CSV = """Partida,Horário,Campeonato
Manchester City x Chelsea,16:30,Premier League
Arsenal x Everton,14:00,Premier League
Real Madrid x Barcelona,17:00,LaLiga
"""

failures: list[str] = []


def check(condition: bool, label: str) -> None:
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures.append(label)


async def main() -> int:
    csv_path = Path(tempfile.gettempdir()) / "bve-research.csv"
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
        await button.click()

        await page.wait_for_url("**/processamento", timeout=30000)
        await page.get_by_text("Auditoria da ingestão").wait_for(timeout=180000)
        await page.wait_for_timeout(4000)

        body = await page.locator("body").inner_text()
        check("Desk Research / Dados Públicos" in body, "modo de coleta Desk Research exibido")
        check("RESEARCH_ADAPTER" in body.upper(), "fonte research_adapter presente na auditoria")

        # Abre o detalhe da primeira partida e confere fontes/histórico/métricas.
        await page.get_by_role("button", name="Manchester City").first.click()
        await page.wait_for_timeout(1500)
        detail = await page.locator("body").inner_text()

        check("football" in detail.lower() or "http" in detail.lower(), "URL da fonte pública registrada")
        check("histórico" in detail.lower(), "estado do histórico pré-jogo exibido")
        check("aceitas:" in detail.lower(), "métricas aceitas listadas")
        check("rejeitadas:" in detail.lower(), "métricas rejeitadas listadas")
        check(
            "corners_taken" in detail or "goals_scored" in detail,
            "métricas canônicas normalizadas presentes",
        )
        check(
            "shots_total" in detail or "shots_on_target" in detail,
            "finalizações registradas como rejeitadas por definição incompatível",
        )

        # O pipeline deve terminar em estado honesto, sem inventar probabilidade.
        await page.wait_for_url("**/oportunidades", timeout=240000)
        await page.wait_for_timeout(3000)
        final = await page.locator("body").inner_text()
        check(
            "MODEL_NOT_PRODUCTION_VALIDATED" in final or "Nenhum contrato foi publicado" in final,
            "sem modelo validado, o motor bloqueia em vez de inventar probabilidade",
        )
        check(not errors, f"sem erros de runtime no navegador ({errors[:1]})")

        await browser.close()

    print("\n%d verificações falharam" % len(failures) if failures else "\nTodas as verificações passaram")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
