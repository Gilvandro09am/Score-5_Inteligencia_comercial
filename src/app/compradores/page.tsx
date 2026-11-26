import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Abas } from "@/components/Abas";
import { CampoSelect } from "@/components/CampoSelect";
import { DivergenciaBi } from "@/components/DivergenciaBi";
import {
  carregarCompradores,
  type ClienteCompra,
  competenciaTexto,
  dinheiro,
  numero,
  opcoes,
  percentual,
  DIAS_SEMANA,
  diasVisita,
  NOME_DIA,
  plural,
  REGIOES,
  regiaoDaOperacao,
} from "@/lib/score5";

export const metadata: Metadata = {
  title: "Compradores · Score 5",
};

// ==================================================
// FILTROS
// ==================================================

const CHAVES = ["regiao", "operacao", "gv", "setor", "cidade", "visita", "situacao", "pdv", "motivo"] as const;
type Filtros = Record<(typeof CHAVES)[number], string>;

const SITUACOES: Record<string, string> = {
  comprou: "Compraram (venda ou bonificação)",
  bonificacao: "Só bonificação",
  nao: "Ainda não compraram",
};

function naSituacao(c: ClienteCompra, s: string) {
  if (!s) return true;
  if (s === "comprou") return c.situacao !== "nao";
  return c.situacao === s;
}

const LIMITE_LINHAS = 600;

const comprou = (c: ClienteCompra) => c.situacao !== "nao";
const nomeOperacao = (o: string) => o.replace(/^Pau Brasil /, "");

function dataCurta(iso: string) {
  const [a, m, d] = iso.split("-");
  return a ? `${d}/${m}/${a}` : "—";
}

type LinhaRn = {
  operacao: string;
  setor: string;
  gv: string;
  nome: string;
  compraram: number;
  venda: number;
  bonificacao: number;
  carteira: number;
  positivados: number;
  valor: number;
  meta: number | null;
};

// ==================================================
// PÁGINA
// ==================================================

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function PaginaCompradores({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
          Carregando compradores…
        </main>
      }
    >
      <Compradores searchParams={searchParams} />
    </Suspense>
  );
}

async function Compradores({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const ler = (nome: string) => {
    const v = params[nome];
    return typeof v === "string" ? v.trim() : "";
  };
  const filtros = Object.fromEntries(CHAVES.map((k) => [k, ler(k)])) as Filtros;

  const base = await carregarCompradores();
  const todos = base.clientes;

  // Cascata Operação agrupada → Operação → GV → RN → Cidade
  const regioes = Object.keys(REGIOES).filter((r) => todos.some((c) => regiaoDaOperacao(c.operacao) === r));
  const porRegiao = todos.filter((c) => !filtros.regiao || regiaoDaOperacao(c.operacao) === filtros.regiao);
  const operacoes = opcoes(porRegiao.map((c) => c.operacao));
  const porOperacao = porRegiao.filter((c) => !filtros.operacao || c.operacao === filtros.operacao);
  const gvs = opcoes(porOperacao.map((c) => c.gv));
  const porGv = porOperacao.filter((c) => !filtros.gv || c.gv === filtros.gv);
  const setores = opcoes(porGv.map((c) => c.setor));
  const nomeDoSetor = new Map(porGv.map((c) => [c.setor, c.rn]));
  // No filtro de RN, o cliente da carteira também conta para o RN mesmo que outro setor tenha faturado
  const doRn = (c: ClienteCompra) => !filtros.setor || c.setor === filtros.setor || c.carteira === filtros.setor;
  const porRn = porGv.filter(doRn);
  const cidades = opcoes(porRn.map((c) => c.cidade));
  const porCidade = porRn.filter((c) => !filtros.cidade || c.cidade === filtros.cidade);
  // Dia de visita do RN (dClientes): "SEG/QUI/" entra em segunda e em quinta
  const diasComCliente = new Set(porCidade.flatMap((c) => diasVisita(c.visita)));
  const dias = DIAS_SEMANA.filter((d) => diasComCliente.has(d));
  const porVisita = porCidade.filter(
    (c) =>
      !filtros.visita ||
      (filtros.visita === "SEM" ? diasVisita(c.visita).length === 0 : diasVisita(c.visita).includes(filtros.visita))
  );
  // Meta é do setor inteiro: com recorte de cidade ou dia de visita a comparação não vale
  const recorte = Boolean(filtros.cidade || filtros.visita);

  // Indicadores (antes do filtro de situação/PDV)
  const compradores = porVisita.filter((c) => (!filtros.setor || c.setor === filtros.setor) && comprou(c));
  const soBonificacao = compradores.filter((c) => c.situacao === "bonificacao").length;
  const carteira = porVisita.filter((c) => c.carteira && (!filtros.setor || c.carteira === filtros.setor));
  const positivados = carteira.filter(comprou).length;
  const faltam = carteira.length - positivados;
  const valor = compradores.reduce((s, c) => s + c.valor, 0);

  // Resumo por RN
  const porChave = new Map<string, LinhaRn>();
  const linhaDe = (operacao: string, setor: string) => {
    const k = `${operacao}|${setor}`;
    let l = porChave.get(k);
    if (!l) {
      const rn = base.rns[k];
      l = {
        operacao,
        setor,
        gv: rn?.gv ?? "",
        nome: rn?.nome ?? "",
        compraram: 0,
        venda: 0,
        bonificacao: 0,
        carteira: 0,
        positivados: 0,
        valor: 0,
        meta: recorte ? null : (base.metas[k] ?? null),
      };
      porChave.set(k, l);
    }
    return l;
  };
  for (const c of porVisita) {
    if (comprou(c) && (!filtros.setor || c.setor === filtros.setor)) {
      const l = linhaDe(c.operacao, c.setor);
      l.compraram++;
      if (c.situacao === "venda") l.venda++;
      else l.bonificacao++;
      l.valor += c.valor;
    }
    if (c.carteira && (!filtros.setor || c.carteira === filtros.setor)) {
      const l = linhaDe(c.operacao, c.carteira);
      l.carteira++;
      if (comprou(c)) l.positivados++;
    }
  }
  // RNs com meta no filtro (mesmo sem compradores ainda)
  if (!recorte) {
    for (const k of Object.keys(base.metas)) {
      const [operacao, setor] = k.split("|");
      const rn = base.rns[k];
      if (filtros.regiao && regiaoDaOperacao(operacao) !== filtros.regiao) continue;
      if (filtros.operacao && operacao !== filtros.operacao) continue;
      if (filtros.gv && rn?.gv !== filtros.gv) continue;
      if (filtros.setor && setor !== filtros.setor) continue;
      linhaDe(operacao, setor);
    }
  }
  const comMeta = [...porChave.values()].filter((l) => l.meta !== null);
  const metaTotal = comMeta.reduce((s, l) => s + (l.meta ?? 0), 0);
  const compraramComMeta = comMeta.reduce((s, l) => s + l.compraram, 0);
  // Falta = soma do que falta em cada RN (quem passou da meta não compensa quem não bateu)
  const faltaMeta = comMeta.reduce((s, l) => s + Math.max(0, (l.meta ?? 0) - l.compraram), 0);
  const rnsNaMeta = comMeta.filter((l) => l.compraram >= (l.meta ?? 0)).length;

  const linhasRn = [...porChave.values()].sort(
    (a, b) =>
      a.operacao.localeCompare(b.operacao, "pt-BR") ||
      (a.setor === "0" ? 1 : 0) - (b.setor === "0" ? 1 : 0) ||
      a.setor.localeCompare(b.setor, "pt-BR", { numeric: true })
  );

  // Lista de clientes
  const termo = filtros.pdv.toLocaleLowerCase("pt-BR");
  const lista = porVisita
    .filter((c) => naSituacao(c, filtros.situacao))
    .filter((c) => !termo || c.pdv === termo || c.nome.toLocaleLowerCase("pt-BR").includes(termo))
    .sort(
      (a, b) =>
        a.operacao.localeCompare(b.operacao, "pt-BR") ||
        (a.carteira || a.setor).localeCompare(b.carteira || b.setor, "pt-BR", { numeric: true }) ||
        Number(comprou(a)) - Number(comprou(b)) ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );
  const visiveis = lista.slice(0, LIMITE_LINHAS);

  const filtrosAtivos = CHAVES.filter((k) => filtros[k]).length;
  const hrefCom = (extra: Partial<Filtros>) =>
    `/compradores?${new URLSearchParams(Object.entries({ ...filtros, ...extra }).filter(([, v]) => v)).toString()}`;

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
              <p className="text-xs text-slate-400">Compradores · Clientes que já compraram no mês</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300">
            {competenciaTexto(base.mes.replace("-", ""))} · faturado até{" "}
            <span className="font-semibold text-white">{dataCurta(base.ultimaEmissao)}</span>
          </div>
        </div>
      </header>
      <Abas atual="compradores" />

      <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 md:px-6">
        {/* Filtros */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Filtros</h2>
            {filtrosAtivos > 0 && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                {plural(filtrosAtivos, "filtro ativo", "filtros ativos")}
              </span>
            )}
          </div>

          <form method="GET" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
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
                itens={operacoes.map((o) => ({ valor: o, texto: nomeOperacao(o) }))}
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
                itens={setores.map((s) => ({
                  valor: s,
                  texto: s === "0" ? "Balcão / sem RN" : nomeDoSetor.get(s) ? `${s} · ${nomeDoSetor.get(s)}` : s,
                }))}
              />
              <CampoSelect
                nome="cidade"
                rotulo="Cidade"
                valor={filtros.cidade}
                todos="Todas"
                itens={cidades.map((c) => ({ valor: c, texto: c }))}
              />
              <CampoSelect
                nome="visita"
                rotulo="Dia de visita do RN"
                valor={filtros.visita}
                todos="Todos os dias"
                itens={[
                  ...dias.map((d) => ({ valor: d, texto: NOME_DIA[d] ?? d })),
                  { valor: "SEM", texto: "Sem dia de visita" },
                ]}
              />
              <CampoSelect
                nome="situacao"
                rotulo="Situação do cliente"
                valor={filtros.situacao}
                todos="Todos"
                itens={Object.entries(SITUACOES).map(([valor, texto]) => ({ valor, texto }))}
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="h-10 rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                Aplicar filtros
              </button>
              <Link
                href="/compradores"
                className="flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Limpar
              </Link>
              <Link
                href={hrefCom({ situacao: "nao" })}
                className="flex h-10 items-center rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100"
              >
                Quem ainda não comprou
              </Link>
              <p className="ml-auto text-xs text-slate-500">
                Notas faturadas de venda (op. 1) e bonificação (op. 2), sem canceladas e devolvidas. Filtros em cascata.
              </p>
            </div>
          </form>
        </section>

        {/* Indicadores */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Kpi
            titulo="Falta para a meta"
            valor={comMeta.length ? numero(faltaMeta) : "—"}
            detalhe={
              comMeta.length
                ? `${numero(compraramComMeta)} de ${numero(metaTotal)} compradores (${percentual(
                    metaTotal ? (compraramComMeta / metaTotal) * 100 : null
                  )}) · ${rnsNaMeta} de ${plural(comMeta.length, "RN", "RNs")} na meta`
                : recorte
                  ? "Meta é por setor: tire o filtro de cidade/dia de visita"
                  : "Sem meta para os filtros"
            }
            destaque="amber"
          />
          <Kpi
            titulo="Clientes que compraram"
            valor={numero(compradores.length)}
            detalhe={`${numero(compradores.length - soBonificacao)} com venda · ${numero(soBonificacao)} só bonificação`}
            destaque="emerald"
          />
          <Kpi
            titulo="Positivação da carteira"
            valor={percentual(carteira.length ? (positivados / carteira.length) * 100 : null)}
            detalhe={`${numero(positivados)} de ${numero(carteira.length)} clientes ativos`}
            destaque="indigo"
          />
          <Kpi
            titulo="Ainda não compraram"
            valor={numero(faltam)}
            detalhe="Clientes ativos da carteira sem nota no mês"
            destaque="rose"
          />
          <Kpi titulo="Faturado (venda)" valor={dinheiro(valor)} detalhe="Total das notas de venda dos compradores" />
        </section>

        {base.clientes.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            Os compradores ainda não foram publicados. Rode <code>npm run processar</code> e <code>npm run publicar</code>.
          </section>
        ) : (
          <>
            {/* Por RN */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Compradores por RN</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Compraram = clientes com nota faturada pelo RN no mês. Falta p/ meta = meta de compradores do setor −
                  compraram. Positivação = clientes ativos da carteira do RN (dClientes) que já compraram.
                </p>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Operação</th>
                      <th className="px-4 py-2.5 font-semibold">RN</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Compraram</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Meta</th>
                      <th className="px-4 py-2.5 font-semibold">Atingimento</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Falta p/ meta</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Venda</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Só bonif.</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Carteira</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Positivação</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Sem compra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {linhasRn.map((l) => {
                      const pct = l.carteira ? (l.positivados / l.carteira) * 100 : null;
                      const pctMeta = l.meta ? (l.compraram / l.meta) * 100 : null;
                      return (
                        <tr key={`${l.operacao}|${l.setor}`} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-2 text-slate-600">{nomeOperacao(l.operacao)}</td>
                          <td className="px-4 py-2">
                            <Link
                              href={hrefCom({ operacao: l.operacao, setor: l.setor, gv: "" })}
                              className="font-semibold text-slate-900 hover:text-indigo-700"
                            >
                              {l.setor === "0" ? "Balcão / sem RN" : `${l.setor}${l.nome ? ` · ${l.nome}` : ""}`}
                            </Link>
                            {l.gv && <span className="ml-1.5 text-xs text-slate-400">GV {l.gv}</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-bold tabular-nums">{numero(l.compraram)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                            {l.meta !== null ? numero(l.meta) : "—"}
                          </td>
                          <td className="min-w-[150px] px-4 py-2">
                            {pctMeta === null ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={`h-full rounded-full ${
                                      pctMeta >= 100 ? "bg-emerald-500" : pctMeta >= 90 ? "bg-amber-400" : "bg-rose-500"
                                    }`}
                                    style={{ width: `${Math.min(100, pctMeta)}%` }}
                                  />
                                </div>
                                <span className="w-12 text-right text-xs font-semibold tabular-nums">
                                  {percentual(pctMeta)}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {l.meta === null ? (
                              "—"
                            ) : l.compraram >= l.meta ? (
                              <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                                Bateu{l.compraram > l.meta ? ` +${numero(l.compraram - l.meta)}` : ""}
                              </span>
                            ) : (
                              <span className="inline-flex min-w-8 justify-center rounded-md bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-900">
                                {numero(l.meta - l.compraram)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">{numero(l.venda)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">{numero(l.bonificacao)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                            {l.carteira ? numero(l.carteira) : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-slate-600">
                            {percentual(pct)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {l.carteira ? (
                              <Link
                                href={hrefCom({ operacao: l.operacao, setor: l.setor, gv: "", situacao: "nao" })}
                                className="font-semibold text-rose-700 hover:underline"
                              >
                                {numero(l.carteira - l.positivados)}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {linhasRn.length === 0 && (
                  <p className="p-10 text-center text-sm text-slate-500">Nenhum RN para os filtros selecionados.</p>
                )}
              </div>
            </section>

            <DivergenciaBi base={base} filtros={filtros} hrefCom={hrefCom} />

            {/* Clientes */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Clientes</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {plural(lista.length, "cliente", "clientes")}. Por RN, com quem ainda não comprou primeiro.
                </p>
              </div>
              <div className="max-h-[75vh] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">RN</th>
                      <th className="px-4 py-2.5 font-semibold">PDV</th>
                      <th className="px-4 py-2.5 font-semibold">Situação</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Notas</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Venda no mês</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Última compra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visiveis.map((c) => (
                      <tr key={`${c.operacao}|${c.pdv}`}>
                        <td className="whitespace-nowrap px-4 py-2 align-top font-semibold tabular-nums text-slate-700">
                          {c.carteira || c.setor}
                          {c.carteira && c.setor !== c.carteira && comprou(c) && (
                            <p className="text-[11px] font-normal text-slate-400">
                              faturado {c.setor === "0" ? "no balcão" : `pelo ${c.setor}`}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2 align-top">
                          <p className="font-semibold text-slate-900">{c.nome || `PDV ${c.pdv}`}</p>
                          <p className="text-xs text-slate-500">
                            {c.pdv} · {c.cidade} · {nomeOperacao(c.operacao)}
                            {c.visita && ` · visita ${c.visita.replace(/\/$/, "")}`}
                            {!c.carteira && " · fora da carteira ativa"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 align-top">
                          <Situacao c={c} />
                        </td>
                        <td className="px-4 py-2 text-right align-top tabular-nums text-slate-600">
                          {c.notas ? numero(c.notas) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right align-top tabular-nums text-slate-600">
                          {c.valor ? dinheiro(c.valor) : "—"}
                        </td>
                        <td className="px-4 py-2 text-center align-top tabular-nums text-slate-600">
                          {c.ultimaCompra || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lista.length === 0 && (
                  <p className="p-10 text-center text-sm text-slate-500">Nenhum cliente para os filtros selecionados.</p>
                )}
                {lista.length > LIMITE_LINHAS && (
                  <p className="border-t border-slate-200 bg-amber-50 p-4 text-center text-sm text-amber-800">
                    Mostrando {numero(LIMITE_LINHAS)} de {numero(lista.length)} clientes. Filtre por GV ou RN para ver
                    todos.
                  </p>
                )}
              </div>
            </section>
          </>
        )}

        <p className="pb-2 text-center text-xs text-slate-400">
          Score 5 · Inteligência Comercial — dados comerciais de uso interno.
        </p>
      </div>
    </main>
  );
}

function Situacao({ c }: { c: ClienteCompra }) {
  const [texto, cor] =
    c.situacao === "venda"
      ? ["Comprou", "bg-emerald-50 text-emerald-800 ring-emerald-200"]
      : c.situacao === "bonificacao"
        ? ["Só bonificação", "bg-violet-50 text-violet-800 ring-violet-200"]
        : ["Não comprou", "bg-rose-50 text-rose-800 ring-rose-200"];
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cor}`}>{texto}</span>
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
  destaque?: "rose" | "emerald" | "indigo" | "amber";
}) {
  const borda =
    destaque === "rose"
      ? "border-l-rose-500"
      : destaque === "amber"
        ? "border-l-amber-500"
      : destaque === "emerald"
        ? "border-l-emerald-500"
        : destaque === "indigo"
          ? "border-l-indigo-500"
          : "border-l-slate-300";
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${borda} bg-white px-4 py-3.5 shadow-sm`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{valor}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>
    </div>
  );
}
