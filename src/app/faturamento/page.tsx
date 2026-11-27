import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Abas } from "@/components/Abas";
import { CampoSelect } from "@/components/CampoSelect";
import {
  carregarClientes,
  carregarFaturamento,
  type Cliente,
  dinheiro,
  dinheiroSinal,
  type FaturamentoPdv,
  numero,
  opcoes,
  percentual,
  plural,
  REGIOES,
  regiaoDaOperacao,
} from "@/lib/score5";

export const metadata: Metadata = {
  title: "Faturamento · Score 5",
};

// ==================================================
// FILTROS
// ==================================================

const CHAVES = ["regiao", "operacao", "gv", "setor", "cidade", "situacao", "pdv"] as const;
type Filtros = Record<(typeof CHAVES)[number], string>;

const SITUACOES: Record<string, string> = {
  divergente: "Divergentes (acomp ≠ Score)",
  acompMaior: "Acomp maior que o Score",
  scoreMaior: "Score maior que o acomp",
  bate: "Batem",
  bateuAcomp: "Bateu meta no faturado, pendente no Score",
};

type Linha = FaturamentoPdv & { cliente?: Cliente };

// Bateu a meta pelo faturado, mas o Score ainda não conta (sem Task FAT ok e real abaixo da meta)
const bateuSoNoAcomp = (l: Linha) => l.faltaAcomp === 0 && l.realScore < l.meta && !l.taskOk;

function naSituacao(l: Linha, s: string) {
  if (!s) return true;
  if (s === "divergente") return l.situacao !== "bate";
  if (s === "bateuAcomp") return bateuSoNoAcomp(l);
  return l.situacao === s;
}

const LIMITE_LINHAS = 400;
const nomeOperacao = (o: string) => o.replace(/^Pau Brasil /, "");

function dataCurta(iso: string) {
  const [a, m, d] = iso.split("-");
  return a ? `${d}/${m}/${a}` : "—";
}

type LinhaRn = {
  operacao: string;
  gv: string;
  rn: string;
  pdvs: number;
  batem: number;
  real: number;
  acomp: number;
  acompTotal: number;
  bateuAcomp: number;
};

// ==================================================
// PÁGINA
// ==================================================

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function PaginaFaturamento({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
          Carregando faturamento…
        </main>
      }
    >
      <Faturamento searchParams={searchParams} />
    </Suspense>
  );
}

async function Faturamento({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const ler = (nome: string) => {
    const v = params[nome];
    return typeof v === "string" ? v.trim() : "";
  };
  const filtros = Object.fromEntries(CHAVES.map((k) => [k, ler(k)])) as Filtros;

  const [base, clientes] = await Promise.all([carregarFaturamento(), carregarClientes()]);
  const porChave = new Map(clientes.map((c) => [c.pdv, c]));
  const todas: Linha[] = base.pdvs.map((p) => ({ ...p, cliente: porChave.get(p.chave) }));
  const op = (l: Linha) => l.cliente?.operacao ?? "";

  // Cascata Operação agrupada → Operação → GV → RN → Cidade
  const regioes = Object.keys(REGIOES).filter((r) => todas.some((l) => regiaoDaOperacao(op(l)) === r));
  const porRegiao = todas.filter((l) => !filtros.regiao || regiaoDaOperacao(op(l)) === filtros.regiao);
  const operacoes = opcoes(porRegiao.map(op));
  const porOperacao = porRegiao.filter((l) => !filtros.operacao || op(l) === filtros.operacao);
  const gvs = opcoes(porOperacao.map((l) => l.cliente?.gv ?? ""));
  const porGv = porOperacao.filter((l) => !filtros.gv || l.cliente?.gv === filtros.gv);
  const setores = opcoes(porGv.map((l) => l.cliente?.rn ?? ""));
  const porRn = porGv.filter((l) => !filtros.setor || l.cliente?.rn === filtros.setor);
  const cidades = opcoes(porRn.map((l) => l.cliente?.cidade ?? ""));
  const escopo = porRn.filter((l) => !filtros.cidade || l.cliente?.cidade === filtros.cidade);

  // Indicadores (antes do filtro de situação/PDV)
  const batem = escopo.filter((l) => l.situacao === "bate").length;
  const divergentes = escopo.filter((l) => l.situacao !== "bate");
  const somaReal = escopo.reduce((s, l) => s + l.realScore, 0);
  const somaAcomp = escopo.reduce((s, l) => s + l.acompCorte, 0);
  const depoisDoCorte = escopo.reduce((s, l) => s + (l.acompTotal - l.acompCorte), 0);
  const bateuAcomp = escopo.filter(bateuSoNoAcomp);

  // Por RN
  const rns = new Map<string, LinhaRn>();
  for (const l of escopo) {
    const k = `${op(l)}|${l.cliente?.rn ?? ""}`;
    let r = rns.get(k);
    if (!r) {
      r = { operacao: op(l), gv: l.cliente?.gv ?? "", rn: l.cliente?.rn ?? "", pdvs: 0, batem: 0, real: 0, acomp: 0, acompTotal: 0, bateuAcomp: 0 };
      rns.set(k, r);
    }
    r.pdvs++;
    if (l.situacao === "bate") r.batem++;
    r.real += l.realScore;
    r.acomp += l.acompCorte;
    r.acompTotal += l.acompTotal;
    if (bateuSoNoAcomp(l)) r.bateuAcomp++;
  }
  const linhasRn = [...rns.values()].sort(
    (a, b) =>
      b.pdvs - b.batem - (a.pdvs - a.batem) ||
      a.operacao.localeCompare(b.operacao, "pt-BR") ||
      a.rn.localeCompare(b.rn, "pt-BR", { numeric: true })
  );

  // Lista de PDVs: divergência maior primeiro
  const termo = filtros.pdv.toLocaleLowerCase("pt-BR");
  const lista = escopo
    .filter((l) => naSituacao(l, filtros.situacao))
    .filter(
      (l) =>
        !termo ||
        l.chave.toLocaleLowerCase("pt-BR").includes(termo) ||
        (l.cliente?.nomeFantasia ?? "").toLocaleLowerCase("pt-BR").includes(termo)
    )
    .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca) || a.chave.localeCompare(b.chave));
  const visiveis = lista.slice(0, LIMITE_LINHAS);

  const filtrosAtivos = CHAVES.filter((k) => filtros[k]).length;
  const hrefCom = (extra: Partial<Filtros>) =>
    `/faturamento?${new URLSearchParams(Object.entries({ ...filtros, ...extra }).filter(([, v]) => v)).toString()}`;

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
              <p className="text-xs text-slate-400">Faturamento · Acomp 03.02.37 × Real Task do Score</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300">
            Score contou até <span className="font-semibold text-white">{dataCurta(base.corte)}</span> · faturado até{" "}
            <span className="font-semibold text-white">{dataCurta(base.ultimaEmissao)}</span>
          </div>
        </div>
      </header>
      <Abas atual="faturamento" />

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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
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
                itens={setores.map((s) => ({ valor: s, texto: s }))}
              />
              <CampoSelect
                nome="cidade"
                rotulo="Cidade"
                valor={filtros.cidade}
                todos="Todas"
                itens={cidades.map((c) => ({ valor: c, texto: c }))}
              />
              <CampoSelect
                nome="situacao"
                rotulo="Situação"
                valor={filtros.situacao}
                todos="Todos os PDVs"
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
                href="/faturamento"
                className="flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Limpar
              </Link>
              <Link
                href={hrefCom({ situacao: "divergente" })}
                className="flex h-10 items-center rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100"
              >
                Só divergentes
              </Link>
              <Link
                href={hrefCom({ situacao: "bateuAcomp" })}
                className="flex h-10 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                Bateram no faturado
              </Link>
              <p className="ml-auto max-w-xl text-xs text-slate-500">
                Acomp = cesta {base.cesta || "Cerveja TT"} no 03.02.37: venda (op. 1) + bonificação (op. 2), notas A/E,
                coluna Total. Comparado com o Real Task até o dia de corte do relatório.
              </p>
            </div>
          </form>
        </section>

        {/* Indicadores */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Kpi
            titulo="PDVs que batem"
            valor={`${numero(batem)} de ${numero(escopo.length)}`}
            detalhe={`${percentual(escopo.length ? (batem / escopo.length) * 100 : null)} iguais ao Real Task (±R$ 1)`}
            destaque="emerald"
          />
          <Kpi
            titulo="PDVs divergentes"
            valor={numero(divergentes.length)}
            detalhe={`${numero(divergentes.filter((l) => l.situacao === "acompMaior").length)} acomp maior · ${numero(
              divergentes.filter((l) => l.situacao === "scoreMaior").length
            )} Score maior`}
            destaque="rose"
          />
          <Kpi
            titulo="Diferença até o corte"
            valor={dinheiroSinal(somaAcomp - somaReal)}
            detalhe={`Acomp ${dinheiro(somaAcomp)} × Score ${dinheiro(somaReal)}`}
            destaque="amber"
          />
          <Kpi
            titulo="Faturado depois do corte"
            valor={dinheiro(depoisDoCorte)}
            detalhe={`Notas após ${dataCurta(base.corte)}: entram no próximo relatório`}
          />
          <Kpi
            titulo="Bateram no faturado"
            valor={numero(bateuAcomp.length)}
            detalhe="Meta batida no 03.02.37, ainda pendente no Score"
            destaque="indigo"
          />
        </section>

        {base.pdvs.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            O acomp de faturamento ainda não foi publicado. Rode <code>npm run processar</code> e <code>npm run publicar</code>.
          </section>
        ) : (
          <>
            {/* Por RN */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">Por RN</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Só PDVs com meta de faturamento. RNs com mais PDVs divergentes primeiro.
                </p>
              </div>
              <div className="max-h-[50vh] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Operação</th>
                      <th className="px-4 py-2.5 font-semibold">RN</th>
                      <th className="px-4 py-2.5 text-right font-semibold">PDVs</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Batem</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Divergem</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Real Score</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Acomp até o corte</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Diferença</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Acomp até hoje</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Bateram no fat.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {linhasRn.map((r) => {
                      const dif = r.acomp - r.real;
                      return (
                        <tr key={`${r.operacao}|${r.rn}`} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-2 text-slate-600">{nomeOperacao(r.operacao)}</td>
                          <td className="px-4 py-2">
                            <Link
                              href={hrefCom({ operacao: r.operacao, setor: r.rn, gv: "" })}
                              className="font-semibold text-slate-900 hover:text-indigo-700"
                            >
                              {r.rn}
                            </Link>
                            {r.gv && <span className="ml-1.5 text-xs text-slate-400">GV {r.gv}</span>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{numero(r.pdvs)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{numero(r.batem)}</td>
                          <td className="px-4 py-2 text-right font-bold tabular-nums">
                            {r.pdvs - r.batem ? (
                              <Link
                                href={hrefCom({ operacao: r.operacao, setor: r.rn, gv: "", situacao: "divergente" })}
                                className="text-rose-700 hover:underline"
                              >
                                {numero(r.pdvs - r.batem)}
                              </Link>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">{dinheiro(r.real)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">{dinheiro(r.acomp)}</td>
                          <td
                            className={`px-4 py-2 text-right font-semibold tabular-nums ${
                              Math.abs(dif) <= 1 ? "text-slate-400" : dif > 0 ? "text-rose-700" : "text-amber-700"
                            }`}
                          >
                            {Math.abs(dif) <= 1 ? "—" : dinheiroSinal(dif)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-600">{dinheiro(r.acompTotal)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.bateuAcomp ? (
                              <span className="font-semibold text-indigo-700">{numero(r.bateuAcomp)}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* PDVs */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-900">PDVs</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {plural(lista.length, "PDV", "PDVs")}, maior diferença primeiro. Clique em “notas” para ver as notas de
                  cerveja do mês.
                </p>
              </div>
              <div className="max-h-[75vh] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">PDV</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Meta</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Real Score</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Acomp até o corte</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Diferença</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Acomp até hoje</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Falta p/ meta</th>
                      <th className="px-4 py-2.5 font-semibold">Notas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visiveis.map((l) => (
                      <tr key={l.chave} className={l.situacao === "bate" ? "" : "bg-rose-50/30"}>
                        <td className="px-4 py-2 align-top">
                          <p className="font-semibold text-slate-900">{l.cliente?.nomeFantasia || `PDV ${l.chave}`}</p>
                          <p className="text-xs text-slate-500">
                            {l.chave} · RN {l.cliente?.rn ?? "—"} · {l.cliente?.cidade ?? ""} ·{" "}
                            {nomeOperacao(op(l))}
                          </p>
                          <p className="mt-0.5 flex flex-wrap gap-1">
                            <Selo l={l} />
                            {l.taskOk && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                Task FAT ok
                              </span>
                            )}
                            {bateuSoNoAcomp(l) && (
                              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                                Bateu no faturado
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-2 text-right align-top tabular-nums text-slate-600">{dinheiro(l.meta)}</td>
                        <td className="px-4 py-2 text-right align-top tabular-nums">{dinheiro(l.realScore)}</td>
                        <td className="px-4 py-2 text-right align-top tabular-nums">{dinheiro(l.acompCorte)}</td>
                        <td
                          className={`px-4 py-2 text-right align-top font-bold tabular-nums ${
                            l.situacao === "bate" ? "text-slate-400" : l.diferenca > 0 ? "text-rose-700" : "text-amber-700"
                          }`}
                        >
                          {l.situacao === "bate" ? "—" : dinheiroSinal(l.diferenca)}
                        </td>
                        <td className="px-4 py-2 text-right align-top tabular-nums text-slate-600">
                          {dinheiro(l.acompTotal)}
                          {l.acompTotal - l.acompCorte > 1 && (
                            <p className="text-[11px] text-slate-400">+{dinheiro(l.acompTotal - l.acompCorte)} após o corte</p>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right align-top tabular-nums">
                          {l.faltaAcomp === 0 ? (
                            <span className="text-xs font-bold text-emerald-700">Bateu</span>
                          ) : (
                            <span className="font-semibold text-slate-700">{dinheiro(l.faltaAcomp)}</span>
                          )}
                        </td>
                        <td className="min-w-[220px] px-4 py-2 align-top">
                          {l.notas.length === 0 ? (
                            <span className="text-xs text-slate-400">sem nota de cerveja</span>
                          ) : (
                            <details>
                              <summary className="cursor-pointer text-xs font-medium text-indigo-700">
                                {plural(l.notas.length, "nota", "notas")}
                              </summary>
                              <ul className="mt-1 space-y-0.5 text-[11px] tabular-nums text-slate-600">
                                {l.notas.map((n) => (
                                  <li key={`${n.nota}|${n.bonificacao}`} className="flex justify-between gap-3">
                                    <span>
                                      {n.emissao} · NF {n.nota}
                                      {n.bonificacao && " · bonif."}
                                      {n.status === "E" && " · em rota"}
                                    </span>
                                    <span className="font-medium">{dinheiro(n.valor)}</span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lista.length === 0 && (
                  <p className="p-10 text-center text-sm text-slate-500">Nenhum PDV para os filtros selecionados.</p>
                )}
                {lista.length > LIMITE_LINHAS && (
                  <p className="border-t border-slate-200 bg-amber-50 p-4 text-center text-sm text-amber-800">
                    Mostrando {numero(LIMITE_LINHAS)} de {numero(lista.length)} PDVs. Filtre por operação ou RN.
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

function Selo({ l }: { l: Linha }) {
  const [texto, cor] =
    l.situacao === "bate"
      ? ["Bate", "bg-slate-100 text-slate-600"]
      : l.situacao === "acompMaior"
        ? ["Acomp maior", "bg-rose-100 text-rose-800"]
        : ["Score maior", "bg-amber-100 text-amber-900"];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${cor}`}>{texto}</span>;
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
  const borda = {
    rose: "border-l-rose-500",
    emerald: "border-l-emerald-500",
    indigo: "border-l-indigo-500",
    amber: "border-l-amber-500",
  }[destaque ?? "rose"];
  return (
    <div
      className={`rounded-xl border border-slate-200 border-l-4 ${destaque ? borda : "border-l-slate-300"} bg-white px-4 py-3.5 shadow-sm`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{valor}</p>
      <p className="mt-0.5 text-xs text-slate-500">{detalhe}</p>
    </div>
  );
}
