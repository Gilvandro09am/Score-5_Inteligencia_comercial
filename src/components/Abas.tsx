import Link from "next/link";

const ABAS = [
  { id: "carteira", texto: "Carteira Score 5", href: "/" },
  { id: "tarefas", texto: "Oportunidades de task", href: "/tarefas" },
  { id: "compradores", texto: "Compradores", href: "/compradores" },
  { id: "faturamento", texto: "Faturamento", href: "/faturamento" },
] as const;

export function Abas({ atual }: { atual: (typeof ABAS)[number]["id"] }) {
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 md:px-6">
        {ABAS.map((a) => (
          <Link
            key={a.id}
            href={a.href}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${
              a.id === atual
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {a.texto}
          </Link>
        ))}
      </div>
    </nav>
  );
}
