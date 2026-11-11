"use client";

/**
 * Abre a impressão do navegador ("Salvar como PDF").
 * O título da aba vira o nome sugerido do arquivo.
 */
export function BotaoPdf({ nomeArquivo }: { nomeArquivo: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const anterior = document.title;
        document.title = nomeArquivo;
        window.print();
        document.title = anterior;
      }}
      className="h-10 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
    >
      Baixar PDF
    </button>
  );
}
