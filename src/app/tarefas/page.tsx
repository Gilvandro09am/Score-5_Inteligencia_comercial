import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Abas } from "@/components/Abas";
import { CampoSelect } from "@/components/CampoSelect";
import {
  carregarClientes,
  carregarTarefas,
  numero,
  opcoes,
  plural,
  REGIOES,
  regiaoDaOperacao,
  type Tarefa,
} from "@/lib/score5";

export const metadata: Metadata = {
  title: "Oportunidades do dia · Score 5",
};

// ==================================================
// FILTROS
// ==================================================

const CHAVES = ["regiao", "operacao", "gv", "setor", "cidade", "pdv", "cesta", "cluster", "falta"] as const;
type Filtros = Record<(typeof CHAVES)[number], string>;

const FAIXAS_FALTA: Record<string, string> = {
  "1": "Fecha com 1",
  "2": "Fecha com 2",
  "3": "Fecha com 3",
  "4+": "4 ou mais",
  sem: "Sem quantidade definida",
};

function naFaixa(t: Tarefa, faixa: string) {
  switch (faixa) {
    case "":
      return true;
    case "sem":
      return t.falta === null;
    case "4+":
      return t.falta !== null && t.falta >= 4;
    default:
      return t.falta === Number(faixa);
  }
}

// Menor quantidade primeiro (fecha mais rápido); sem quantidade e já atingidas por último
function pesoFalta(t: Tarefa) {
  if (t.falta === null) return 1e6;
  if (t.falta === 0) return 1e5;
  return t.falta;
}

const LIMITE_LINHAS = 600;

const COR_CESTA: Record<string, string> = {
  "Cerveja Long Neck": "bg-amber-50 text-amber-800 ring-amber-200",
  Cerveja: "bg-yellow-50 text-yellow-800 ring-yellow-200",
  NAB: "bg-sky-50 text-sky-800 ring-sky-200",
  Match: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200",
  Marketplace: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Outras: "bg-slate-50 text-slate-700 ring-slate-200",
};

function dataCurta(iso: string) {
  const [a, m, d] = iso.split("-");
  return a ? `${d}/${m}/${a}` : "—";
}

// ==================================================
// PÁGINA
// ==================================================

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function PaginaTarefas({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
          Carregando oportunidades…
        </main>
      }
    >
      <Oportunidades searchParams={searchParams} />
    </Suspense>
  );
}

async function Oportunidades({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const ler = (nome: string) => {
    const v = params[nome];
    return typeof v === "string" ? v.trim() : "";
  };
  const filtros = Object.fromEntries(CHAVES.map((k) => [k, ler(k)])) as Filtros;

  const [base, clientes] = await Promise.all([carregarTarefas(), carregarClientes()]);
  const nomePorChave = new Map(clientes.map((c) => [c.pdv, c.nomeFantasia]));
  const nomeDe = (t: Tarefa) => nomePorChave.get(t.chave) || base.nomes[t.chave] || "";

  // Cascata Operação agrupada → Operação → GV → Setor (igual à carteira)
  const todas = base.tarefas;
  const regioes = Object.keys(REGIOES).filter((r) => todas.some((t) => regiaoDaOperacao(t.operacao) === r));
  const porRegiao = todas.filter((t) => !filtros.regiao || regiaoDaOperacao(t.operacao) === filtros.regiao);
  const operacoes = opcoes(porRegiao.map((t) => t.operacao));
  const porOperacao = porRegiao.filter((t) => !filtros.operacao || t.operacao === filtros.operacao);
  const gvs = opcoes(porOperacao.map((t) => t.gv));
  const porGv = porOperacao.filter((t) => !filtros.gv || t.gv === filtros.gv);
  const setores = opcoes(porGv.map((t) => t.setor));
  const porRn = porGv.filter((t) => !filtros.setor || t.setor === filtros.setor);
  const cidades = opcoes(porRn.map((t) => t.cidade));
  const porSetor = porRn.filter((t) => !filtros.cidade || t.cidade === filtros.cidade);

  const termo = filtros.pdv.toLocaleLowerCase("pt-BR");
  const porPdv = porSetor.filter(
    (t) => !termo || t.pdv === termo || nomeDe(t).toLocaleLowerCase("pt-BR").includes(termo)
  );
  const clusters = opcoes(porPdv.map((t) => t.cluster));
  const porCluster = porPdv.filter((t) => !filtros.cluster || t.cluster === filtros.cluster);
  const cestas = base.cestas.filter((c) => porCluster.some((t) => t.cesta === c));
  const porCesta = porCluster.filter((t) => !filtros.cesta || t.cesta === filtros.cesta);
  const filtradas = porCesta.filter((t) => naFaixa(t, filtros.falta));

  // Ordem: setor → PDV com tarefa mais rápida de fechar → tarefas do PDV pela quantidade
  const melhorDoPdv = new Map<string, number>();
  for (const t of filtradas) {
    melhorDoPdv.set(t.chave, Math.min(melhorDoPdv.get(t.chave) ?? Infinity, pesoFalta(t)));
  }
  const ordenadas = [...filtradas].sort(
    (a, b) =>
      a.setor.localeCompare(b.setor, "pt-BR", { numeric: true }) ||
      melhorDoPdv.get(a.chave)! - melhorDoPdv.get(b.chave)! ||
      a.chave.localeCompare(b.chave) ||
      pesoFalta(a) - pesoFalta(b) ||
      a.texto.localeCompare(b.texto, "pt-BR")
  );
  const visiveis = ordenadas.slice(0, LIMITE_LINHAS);

  // Indicadores
  const pdvs = new Set(filtradas.map((t) => t.chave)).size;
  const fechaCom1 = filtradas.filter((t) => t.falta === 1);
  const pdvsCom1 = new Set(fechaCom1.map((t) => t.chave)).size;
  const unidades = filtradas.reduce((s, t) => s + (t.falta ?? 0), 0);
  const datas = opcoes(
    Object.entries(base.rotas)
      .filter(([op]) => porOperacao.some((t) => t.operacao === op))
      .map(([, d]) => d)
  );

  const filtrosAtivos = CHAVES.filter((k) => filtros[k]).length;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black">
              S5
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-wide">SCORE 5</h1>
              <p className="text-xs text-slate-400">Oportunidades do dia · Tarefas BEES em aberto</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300">
            Rota de{" "}
            <span className="font-semibold text-white">{datas.length ? datas.map(dataCurta).join(", ") : "—"}</span>
          </div>
        </div>
      </header>
      <Abas atual="tarefas" />

      <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 md:px-6">
        {/* Filtros */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Filtros das tarefas</h2>
            {filtrosAtivos > 0 && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                {plural(filtrosAtivos, "filtro ativo", "filtros ativos")}
              </span>
            )}
          </div>

          <form method="GET" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:grid-cols-9">
              <CampoSelect
                nome="regiao"
                rotulo="Operação agrupada"
                valor={filtros.regiao}
                todos="Todas"
                itens={regioes.map((r) => ({ valor: r, texto: r }))}
              />
              <CampoSelect
                nome="operacao"
                rotulo="Operação"
                valor={filtros.operacao}
                todos="Todas"
                itens={operacoes.map((o) => ({ valor: o, texto: o.replace(/^Pau Brasil /, "") }))}
              />
              <CampoSelect
                nome="gv"
                rotulo="GV"
                valor={filtros.gv}
                itens={gvs.map((g) => ({ valor: g, texto: `GV ${g}` }))}
              />
              <CampoSelect
                nome="setor"
                rotulo="RN (setor)"
                valor={filtros.setor}
                itens={setores.map((s) => ({ valor: s, texto: s }))}
              />
              <CampoSelect
                nome="cidade"
                rotulo="Cidade"
                valor={filtros.cidade}
                todos="Todas"
                itens={cidades.map((c) => ({ valor: c, texto: c }))}
              />
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">PDV</span>
                <input
                  type="search"
                  name="pdv"
                  defaultValue={filtros.pdv}
                  placeholder="Código ou nome"
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>
              <CampoSelect
                nome="cesta"
                rotulo="Cesta"
                valor={filtros.cesta}
                todos="Todas"
                itens={cestas.map((c) => ({ valor: c, texto: c }))}
              />
              <CampoSelect
                nome="cluster"
                rotulo="Cluster"
                valor={filtros.cluster}
                itens={clusters.map((c) => ({ valor: c, texto: c }))}
              />
              <CampoSelect
                nome="falta"
                rotulo="Qtd que fecha a tarefa"
                valor={filtros.falta}
                todos="Todas"
                itens={Object.entries(FAIXAS_FALTA).map(([valor, texto]) => ({ valor, texto }))}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="h-10 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Aplicar filtros
              </button>
              <Link
                href="/tarefas"
                className="flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Limpar
              </Link>
              <Link
                href={`/tarefas?${new URLSearchParams(
                  Object.entries({ ...filtros, falta: "1" }).filter(([, v]) => v)
                ).toString()}`}
                className="flex h-10 items-center rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100"
              >
                Só as que fecham com 1
              </Link>
              <p className="ml-auto text-xs text-slate-500">
                Só tarefas em aberto (OPEN) da rota do dia. Filtros em cascata — aplique para atualizar as opções.
              </p>
            </div>
          </form>
        </section>

        {/* Indicadores */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi titulo="Tarefas em aberto" valor={numero(filtradas.length)} detalhe={`${numero(pdvs)} PDVs`} />
          <Kpi
            titulo="Fecham com 1"
            valor={numero(fechaCom1.length)}
            detalhe={`${numero(pdvsCom1)} PDVs com tarefa a 1 de fechar`}
            destaque="rose"
          />
          <Kpi
            titulo="Quantidade a vender"
            valor={numero(unidades)}
            detalhe="Soma do que falta (tarefas com quantidade)"
            destaque="amber"
          />
          <Kpi
            titulo="Sem quantidade definida"
            valor={numero(filtradas.filter((t) => t.falta === null).length)}
            detalhe="Execução, cobertura ou foto"
          />
        </section>

        {/* Lista */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Tarefas por RN e PDV</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ordenado por RN e pelo PDV mais perto de fechar. “Falta” = QTD solicitada − QTD já comprada.
            </p>
          </div>

          {base.tarefas.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">
              As tarefas do BEES ainda não foram publicadas. Rode <code>npm run processar</code> e{" "}
              <code>npm run publicar</code>.
            </p>
          ) : (
            <div className="max-h-[75vh] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">RN</th>
                    <th className="px-4 py-2.5 font-semibold">PDV</th>
                    <th className="px-4 py-2.5 font-semibold">Cesta</th>
                    <th className="px-4 py-2.5 font-semibold">Texto da tarefa</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Falta vender</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visiveis.map((t, i) => {
                    const novoPdv = i === 0 || visiveis[i - 1].chave !== t.chave;
                    return (
                      <tr key={`${t.chave}-${i}`} className={novoPdv ? "border-t-2 border-t-slate-200" : ""}>
                        <td className="whitespace-nowrap px-4 py-2 align-top font-semibold tabular-nums text-slate-700">
                          {novoPdv ? t.setor : ""}
                        </td>
                        <td className="px-4 py-2 align-top">
                          {novoPdv && (
                            <>
                              <p className="font-semibold text-slate-900">{nomeDe(t) || `PDV ${t.pdv}`}</p>
                              <p className="text-xs text-slate-500">
                                {t.pdv} · {t.cidade} · GV {t.gv} · {t.operacao.replace(/^Pau Brasil /, "")}
                              </p>
                            </>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 align-top">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                              COR_CESTA[t.cesta] ?? COR_CESTA.Outras
                            }`}
                          >
                            {t.cesta}
                          </span>
                        </td>
                        <td className="min-w-[320px] px-4 py-2 align-top text-slate-800">
                          {t.texto}
                          <p className="text-xs text-slate-400">{t.cluster}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-center align-top">
                          <Falta t={t} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filtradas.length === 0 && (
                <p className="p-10 text-center text-sm text-slate-500">Nenhuma tarefa para os filtros selecionados.</p>
              )}
              {filtradas.length > LIMITE_LINHAS && (
                <p className="border-t border-slate-200 bg-amber-50 p-4 text-center text-sm text-amber-800">
                  Mostrando {numero(LIMITE_LINHAS)} de {numero(filtradas.length)} tarefas. Filtre por GV ou RN para ver
                  todas.
                </p>
              )}
            </div>
          )}
        </section>

        <p className="pb-2 text-center text-xs text-slate-400">
          Score 5 · Inteligência Comercial — dados comerciais de uso interno.
        </p>
      </div>
    </main>
  );
}

function Falta({ t }: { t: Tarefa }) {
  if (t.falta === null) return <span className="text-xs text-slate-400">sem qtd</span>;
  const cor =
    t.falta === 0
      ? "bg-emerald-100 text-emerald-800"
      : t.falta === 1
        ? "bg-rose-600 text-white"
        : t.falta <= 3
          ? "bg-amber-100 text-amber-900"
          : "bg-slate-100 text-slate-700";
  return (
    <div>
      <span className={`inline-flex min-w-8 justify-center rounded-md px-2 py-0.5 text-sm font-bold tabular-nums ${cor}`}>
        {t.falta}
      </span>
      <p className="mt-0.5 text-[11px] text-slate-400">
        {t.comprada ?? 0} de {t.solicitada}
      </p>
    </div>
  );
}

function Kpi({
  titulo,
  valor,
  detalhe,
  destaque,
}: {
  titulo: string;
  valor: string;
  detalhe: string;
  destaque?: "rose" | "amber";
}) {
  const borda =
    destaque === "rose" ? "border-l-rose-500" : destaque === "amber" ? "border-l-amber-500" : "border-l-slate-300";
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${borda} bg-white px-4 py-3.5 shadow-sm`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{valor}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>
    </div>
  );
}
