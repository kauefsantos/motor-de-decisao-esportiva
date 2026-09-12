import { Info } from "lucide-react";

const HELP: Record<string, string> = {
  EV: "EV esperado estima a vantagem matemática da aposta com base na chance calculada e na odd disponível. Não é lucro garantido.",
  "Odd de referência": "Odd que representa o preço de equilíbrio estimado pelo modelo para esta opção.",
  Vantagem: "Diferença entre a chance calculada pelo modelo e a chance implícita na odd da casa.",
  CLV: "Compara a odd registrada com a odd mais próxima do início do jogo. Serve para acompanhar a qualidade do preço obtido.",
  ROI: "Retorno realizado sobre o total efetivamente apostado nas apostas já encerradas.",
};

export function MetricHelp({ term }: { term: keyof typeof HELP }) {
  return (
    <details className="group relative inline-block align-middle">
      <summary
        className="touch-target ml-1 inline-flex min-h-8 min-w-8 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`O que significa ${term}?`}
      >
        <Info className="size-3.5" aria-hidden />
      </summary>
      <div
        role="note"
        className="metric-help-popover absolute left-0 z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-xl"
      >
        <strong className="font-medium">{term}</strong>
        <p className="mt-1 text-muted-foreground">{HELP[term]}</p>
      </div>
    </details>
  );
}
