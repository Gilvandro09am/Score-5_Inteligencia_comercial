
import fs from "node:fs/promises";
import path from "node:path";

export const instant = false;

type Produto = {
  nome: string;
  coluna: number;
  realizado: number;
  comprado: boolean;
};

type Cesta = {
  id: string;
  nome: string;
  meta: number | null;
  realizado: number;
  faltam: number | null;
  atingimento: number | null;
  status: string;
  produtos: Produto[];
  oportunidades: string[];
  oportunidadesOneWay: string[];
};

type Cliente = {
  chave: string;
  competencia: string;
  pdv: string;
  nomeFantasia: string;
  visita: string;
  base: string;
  operacao: string;
  gv: string;
  rn: string;
  faturamento: {
    meta: number | null;
    realizado: number;
    faltam: number | null;
    atingimento: number | null;
    status: string;
  };
  cestas: Cesta[];
  cestasPendentes: number;
  cestasConcluidas: number;
};

type Filtros = {
  operacao?: string;
  gv?: string;
  rn?: string;
  busca?: string;
  pdv?: string;
};

function dinheiro(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "Sem meta";

  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function numero(valor: number) {
  return valor.toLocaleString("pt-BR");
}

function percentual(valor: number | null) {
  return valor === null ? "—" : `${valor.toLocaleString("pt-BR")}%`;
}

function classeStatus(status: string) {
  if (status === "CONCLUIDA") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "PENDENTE") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-500";
}

function nomeStatus(status: string) {
  if (status === "CONCLUIDA") return "Concluída";
  if (status === "PENDENTE") return "Pendente";
  return "Sem meta";
}

function opcoes(valores: string[]) {
  return [...new Set(valores)]
    .filter(Boolean)
    .sort((a, b) =>
      a.localeCompare(b, "pt-BR", { numeric: true })
    );
}

async function carregarClientes(): Promise<Cliente[]> {
  const arquivo = path.join(
    process.cwd(),
    "dados",
    "processados",
    "clientes-score5.json"
  );

  const conteudo = await fs.readFile(arquivo, "utf8");

  return JSON.parse(conteudo) as Cliente[];
}

function urlFiltros(filtros: Filtros, pdv?: string) {
  const params = new URLSearchParams();

  if (filtros.operacao) params.set("operacao", filtros.operacao);
  if (filtros.gv) params.set("gv", filtros.gv);
  if (filtros.rn) params.set("rn", filtros.rn);
  if (filtros.busca) params.set("busca", filtros.busca);
  if (pdv) params.set("pdv", pdv);

  return `/?${params.toString()}`;
}

function Indicador({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: string;
  detalhe: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{titulo}</p>
      <p className="mt-2 text-3xl font-bold">{valor}</p>
      <p className="mt-2 text-xs text-slate-500">{detalhe}</p>
    </div>
  );
}

function Detalhamento({
  cliente,
}: {
  cliente: Cliente;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Detalhamento do PDV
          </p>

          <h2 className="mt-2 text-2xl font-bold">
            {cliente.nomeFantasia}
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            {cliente.pdv} · {cliente.base} · Visita: {cliente.visita}
          </p>

          <p className="mt-1 text-sm text-slate-500">
            GV {cliente.gv} · RN {cliente.rn}
          </p>
        </div>

        <span className="rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">
          {cliente.cestasPendentes} cestas pendentes
        </span>
      </div>

      <div className="mt-6 rounded-xl bg-slate-50 p-5">
        <h3 className="font-bold">Faturamento cerveja</h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">Meta</p>
            <p className="font-bold">{dinheiro(cliente.faturamento.meta)}</p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Realizado</p>
            <p className="font-bold">
              {dinheiro(cliente.faturamento.realizado)}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Falta faturar</p>
            <p className="font-bold">
              {dinheiro(cliente.faturamento.faltam)}
            </p>
          </div>
        </div>

        {cliente.faturamento.meta !== null && (
          <div className="mt-4">
            <div className="mb-2 flex justify-between text-xs">
              <span>Atingimento</span>
              <strong>{percentual(cliente.faturamento.atingimento)}</strong>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{
                  width: `${Math.min(100, Math.max(0, cliente.faturamento.atingimento ?? 0))}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <h3 className="mt-7 text-lg font-bold">Portfólio ideal</h3>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {cliente.cestas.map((cesta) => (
          <div
            key={cesta.id}
            className="rounded-xl border border-slate-200 p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-bold">{cesta.nome}</h4>

              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${classeStatus(cesta.status)}`}>
                {nomeStatus(cesta.status)}
              </span>
            </div>

            {cesta.meta === null ? (
              <p className="mt-4 text-sm text-slate-500">
                Este PDV não possui meta nesta cesta.
              </p>
            ) : (
              <>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold">
                      {cesta.realizado} / {cesta.meta}
                    </p>
                    <p className="text-xs text-slate-500">
                      SKUs distintos
                    </p>
                  </div>
                  <p className="text-sm font-semibold">
                    Faltam {cesta.faltam ?? 0}
                  </p>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${
                      cesta.status === "CONCLUIDA"
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, cesta.atingimento ?? 0))}%`,
                    }}
                  />
                </div>

                <p className="mt-2 text-right text-xs text-slate-500">
                  {percentual(cesta.atingimento)}
                </p>

                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  {cesta.produtos.map((produto) => (
                    <div
                      key={produto.coluna}
                      className="flex justify-between gap-3 text-sm"
                    >
                      <span className="text-slate-600">
                        {produto.nome}
                      </span>

                      <span className={`font-semibold ${
                        produto.realizado === 0
                          ? "text-red-600"
                          : "text-emerald-700"
                      }`}>
                        {produto.realizado}
                      </span>
                    </div>
                  ))}
                </div>

                {cesta.status === "PENDENTE" && (
                  <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-bold">
                      Oportunidades comerciais
                    </p>

                    {cesta.oportunidades.length > 0 && (
                      <p className="mt-2">
                        Não compradas: {cesta.oportunidades.join(", ")}
                      </p>
                    )}

                    {cesta.oportunidadesOneWay.length > 0 && (
                      <p className="mt-2">
                        Categorias com apenas uma versão realizada:{" "}
                        {cesta.oportunidadesOneWay.join(", ")}
                      </p>
                    )}

                    <p className="mt-2 font-medium">
                      Priorize a inclusão de {cesta.faltam}{" "}
                      SKU(s) distinto(s).
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const parametro = (nome: string) => {
    const valor = params[nome];
    return typeof valor === "string" ? valor : "";
  };

  const filtros: Filtros = {
    operacao: parametro("operacao"),
    gv: parametro("gv"),
    rn: parametro("rn"),
    busca: parametro("busca"),
    pdv: parametro("pdv"),
  };

  const clientes = await carregarClientes();

  const operacoes = opcoes(clientes.map((c) => c.operacao));

  const clientesOperacao = clientes.filter((c) =>
    !filtros.operacao || c.operacao === filtros.operacao
  );

  const gvs = opcoes(clientesOperacao.map((c) => c.gv));

  const clientesGV = clientesOperacao.filter((c) =>
    !filtros.gv || c.gv === filtros.gv
  );

  const rns = opcoes(clientesGV.map((c) => c.rn));

  const busca = (filtros.busca ?? "").toLocaleLowerCase("pt-BR");

  const filtrados = clientesGV.filter((c) =>
    (!filtros.rn || c.rn === filtros.rn) &&
    (
      !busca ||
      c.nomeFantasia.toLocaleLowerCase("pt-BR").includes(busca) ||
      c.pdv.toLocaleLowerCase("pt-BR").includes(busca)
    )
  );

  const selecionado = filtrados.find((c) => c.pdv === filtros.pdv);

  const comPendencia = filtrados.filter(
    (c) => c.cestasPendentes > 0
  ).length;

  const concluidos = filtrados.filter(
    (c) =>
      c.cestasPendentes === 0 &&
      c.cestas.some((cesta) => cesta.meta !== null)
  ).length;

  const pendentesFaturamento = filtrados.filter(
    (c) => c.faturamento.status === "PENDENTE"
  ).length;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-950 px-5 py-5 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-wide">
              SCORE 5
            </h1>
            <p className="text-sm text-slate-300">
              Inteligência Comercial
            </p>
          </div>

          <div className="rounded-lg bg-slate-800 px-4 py-2 text-sm">
            Competência: {clientes[0]?.competencia ?? "—"}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-7">
        <div>
          <h2 className="text-2xl font-bold md:text-3xl">
            Acompanhamento dos PDVs
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Faturamento, portfólio ideal e oportunidades comerciais.
          </p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold">Filtros comerciais</h3>

          <form method="GET" className="grid gap-3 md:grid-cols-5">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Operação</span>
              <select
                name="operacao"
                defaultValue={filtros.operacao}
                className="w-full rounded-lg border border-slate-300 bg-white p-3"
              >
                <option value="">Todas</option>
                {operacoes.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-600">GV</span>
              <select
                name="gv"
                defaultValue={filtros.gv}
                className="w-full rounded-lg border border-slate-300 bg-white p-3"
              >
                <option value="">Todos</option>
                {gvs.map((gv) => (
                  <option key={gv} value={gv}>{gv}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-600">RN</span>
              <select
                name="rn"
                defaultValue={filtros.rn}
                className="w-full rounded-lg border border-slate-300 bg-white p-3"
              >
                <option value="">Todas</option>
                {rns.map((rn) => (
                  <option key={rn} value={rn}>{rn}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-600">
                Nome Fantasia / PDV
              </span>
              <input
                name="busca"
                defaultValue={filtros.busca}
                placeholder="Pesquisar cliente..."
                className="w-full rounded-lg border border-slate-300 p-3"
              />
            </label>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Filtrar
              </button>

              <a
                href="/"
                className="rounded-lg border border-slate-300 px-4 py-3 text-sm"
              >
                Limpar
              </a>
            </div>
          </form>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador
            titulo="PDVs encontrados"
            valor={numero(filtrados.length)}
            detalhe="Clientes após aplicação dos filtros"
          />
          <Indicador
            titulo="Portfólio pendente"
            valor={numero(comPendencia)}
            detalhe="PDVs com alguma cesta pendente"
          />
          <Indicador
            titulo="Portfólio sem pendências"
            valor={numero(concluidos)}
            detalhe="PDVs com todas as cestas aplicáveis concluídas"
          />
          <Indicador
            titulo="Faturamento pendente"
            valor={numero(pendentesFaturamento)}
            detalhe="PDVs abaixo da meta de faturamento"
          />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="p-5">
            <h3 className="text-lg font-bold">Clientes Score 5</h3>
            <p className="mt-1 text-sm text-slate-500">
              Clique em um PDV para visualizar o detalhamento.
            </p>
          </div>

          <div className="max-h-[650px] overflow-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-4">Nome Fantasia</th>
                  <th className="p-4">Visita</th>
                  <th className="p-4">GV</th>
                  <th className="p-4">RN</th>
                  <th className="p-4">Faturamento</th>
                  <th className="p-4">Cestas pendentes</th>
                  <th className="p-4">Detalhes</th>
                </tr>
              </thead>

              <tbody>
                {filtrados.map((cliente) => (
                  <tr key={cliente.chave} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-4">
                      <p className="font-semibold">{cliente.nomeFantasia}</p>
                      <p className="text-xs text-slate-500">{cliente.pdv}</p>
                    </td>

                    <td className="p-4">{cliente.visita}</td>
                    <td className="p-4">{cliente.gv}</td>
                    <td className="p-4">{cliente.rn}</td>

                    <td className="p-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${classeStatus(cliente.faturamento.status)}`}>
                        {percentual(cliente.faturamento.atingimento)}
                      </span>
                    </td>

                    <td className="p-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        cliente.cestasPendentes > 0
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}>
                        {cliente.cestasPendentes}
                      </span>
                    </td>

                    <td className="p-4">
                      <a
                        href={urlFiltros(filtros, cliente.pdv)}
                        className="font-semibold text-blue-700 hover:underline"
                      >
                        Ver PDV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filtrados.length === 0 && (
              <p className="p-8 text-center text-slate-500">
                Nenhum PDV encontrado para os filtros selecionados.
              </p>
            )}
          </div>
        </section>

        {selecionado && (
          <div id="detalhamento">
            <Detalhamento cliente={selecionado} />
          </div>
        )}

        <p className="pb-5 text-center text-xs text-slate-500">
          Score 5 — Ambiente local de desenvolvimento.
          Dados comerciais privados.
        </p>
      </div>
    </main>
  );
}
