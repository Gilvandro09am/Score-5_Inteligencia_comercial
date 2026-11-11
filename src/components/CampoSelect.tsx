export function CampoSelect({
  nome,
  rotulo,
  valor,
  itens,
  todos = "Todos",
}: {
  nome: string;
  rotulo: string;
  valor: string;
  itens: { valor: string; texto: string }[];
  todos?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-600">{rotulo}</span>
      <select
        name={nome}
        defaultValue={valor}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
      >
        <option value="">{todos}</option>
        {itens.map((i) => (
          <option key={i.valor} value={i.valor}>
            {i.texto}
          </option>
        ))}
      </select>
    </label>
  );
}
